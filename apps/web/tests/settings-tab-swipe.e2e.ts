/** Strip-navigation settings: a touch swipe or an arrow key changes section; a mouse drag never does. */
import type { Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const PHONE = { width: 390, height: 844 } as const

/** The settings dialog of the open panel. */
async function settingsDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor({ timeout: 15_000 })
  return dialog
}

/** The content column showing one section. */
function section(page: Page, id: string): Locator {
  return page.locator(`[data-testid="section-${id}"]`)
}

/** Which section the panel shows, read from the selected strip cell. */
async function activeSection(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const cell = document.querySelector('nav [aria-current="true"]')
    return cell?.textContent ?? undefined
  })
}

/**
 * Drag one touch contact across the settings content. Playwright's
 * `touchscreen` taps only, so the pointer sequence is dispatched directly with
 * the device classification the browser uses for a finger.
 * @param page - page with the settings panel open.
 * @param options - horizontal travel in px and the pointer classification.
 */
async function swipe(page: Page, options: { dx: number; pointerType: 'touch' | 'mouse' | 'pen' }): Promise<void> {
  await page.evaluate(({ dx, pointerType }) => {
    const content = document.querySelector('[data-testid^="section-"]')?.parentElement
    if (!content) throw new Error('settings content is not mounted')
    const box = content.getBoundingClientRect()
    const y = box.top + 40
    const startX = dx < 0 ? box.right - 40 : box.left + 40
    const fire = (type: string, clientX: number): void => {
      content.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 1, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX, clientY: y,
      }))
    }
    fire('pointerdown', startX)
    for (const step of [0.25, 0.5, 0.75, 1]) fire('pointermove', startX + dx * step)
    fire('pointerup', startX + dx)
  }, options)
}

it('changes section with a touch swipe in the strip presentation, without wrapping', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ viewport: PHONE, locale: ZH_BROWSER_LOCALE, hasTouch: true })
  try {
    const page = await context.newPage()
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSettings(page, 'zh')
    await settingsDialog(page)

    // Leftward swipe: the next section, then the last one keeps its place.
    await swipe(page, { dx: -200, pointerType: 'touch' })
    await expect.poll(() => section(page, 'models').count()).toBe(1)
    const last = await activeSection(page)
    await swipe(page, { dx: -200, pointerType: 'touch' })
    await expect.poll(() => section(page, 'agent-presets').count()).toBe(1)
    expect(await activeSection(page)).not.toBe(last)

    // Rightward swipe walks back; the first section does not wrap to the last.
    for (let step = 0; step < 4; step++) await swipe(page, { dx: 200, pointerType: 'touch' })
    await expect.poll(() => section(page, 'general').count()).toBe(1)
    expect(await activeSection(page)).toContain('通用')

    // A mouse drag and a pen drag of the same shape leave the section alone.
    await swipe(page, { dx: -200, pointerType: 'mouse' })
    await expect.poll(() => section(page, 'general').count()).toBe(1)
    await swipe(page, { dx: -200, pointerType: 'pen' })
    await expect.poll(() => section(page, 'models').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await context.close()
  }
})

it('changes section with the arrow, Home, and End keys in the strip presentation', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ viewport: PHONE, locale: ZH_BROWSER_LOCALE, hasTouch: true })
  try {
    const page = await context.newPage()
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSettings(page, 'zh')
    const dialog = await settingsDialog(page)
    await dialog.press('ArrowRight')
    await expect.poll(() => section(page, 'models').count()).toBe(1)
    await dialog.press('End')
    await expect.poll(() => section(page, 'agent-presets').count()).toBe(1)
    await dialog.press('ArrowRight')
    await expect.poll(() => section(page, 'agent-presets').count()).toBe(1)
    await dialog.press('Home')
    await expect.poll(() => section(page, 'general').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await context.close()
  }
})
