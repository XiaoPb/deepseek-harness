/** Session page on a phone: a touch swipe from either edge opens that column, and the reverse swipe closes it. */
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const PHONE = { width: 390, height: 844 } as const

/**
 * Dispatch one horizontal drag across the session frame. Playwright's
 * `touchscreen` taps only, so the pointer sequence is dispatched directly with
 * the device classification the browser reports for the finger.
 * @param page - page showing the session frame.
 * @param options - start point, horizontal travel, and the pointer classification.
 */
async function swipeFrame(
  page: Page,
  options: { fromX: number; dx: number; pointerType: 'touch' | 'mouse' | 'pen' },
): Promise<void> {
  await page.evaluate(({ fromX, dx, pointerType }) => {
    const frame = document.querySelector<HTMLElement>('[class*="frame"]')
    if (frame === null) throw new Error('the session frame is not mounted')
    const fire = (type: string, clientX: number): void => {
      frame.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 41, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX, clientY: 320,
      }))
    }
    fire('pointerdown', fromX)
    for (const step of [0.35, 0.7, 1]) fire('pointermove', fromX + dx * step)
    fire('pointerup', fromX + dx)
  }, options)
  await page.waitForTimeout(500)
}

/**
 * The left column's horizontal offset: `0` while the drawer covers the centre.
 * @param page - page showing the session frame.
 * @returns the column's left edge in px, or NaN when it is not mounted.
 */
async function leftOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const column = document.querySelector<HTMLElement>('[class*="sidebarCol"]')
    if (column === null) return Number.NaN
    return Math.round(column.getBoundingClientRect().left)
  })
}

it('opens the left column with a rightward swipe and closes it with a leftward one', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ viewport: PHONE, locale: ZH_BROWSER_LOCALE, hasTouch: true })
  try {
    const page = await context.newPage()
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '关闭', exact: true }).click().catch(() => {})
    const closed = await leftOffset(page)

    await swipeFrame(page, { fromX: 40, dx: 240, pointerType: 'touch' })
    expect(await leftOffset(page)).toBe(0)

    await swipeFrame(page, { fromX: 120, dx: -240, pointerType: 'touch' })
    expect(await leftOffset(page)).toBe(closed)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await context.close()
  }
}, 120_000)

it('ignores a mouse drag across the session frame', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ viewport: PHONE, locale: ZH_BROWSER_LOCALE, hasTouch: true })
  try {
    const page = await context.newPage()
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '关闭', exact: true }).click().catch(() => {})
    const closed = await leftOffset(page)
    await swipeFrame(page, { fromX: 40, dx: 240, pointerType: 'mouse' })
    expect(await leftOffset(page)).toBe(closed)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await context.close()
  }
}, 120_000)
