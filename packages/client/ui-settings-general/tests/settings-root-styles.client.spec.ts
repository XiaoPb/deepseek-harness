/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')

it('keeps the indicator carrier full-width without inspecting account state', () => {
  expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: 100%;[^}]*margin: 4px 0;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
})

it('moves the content with the swipe variables and hands vertical travel to the scroller', () => {
  expect(css).toMatch(/\.options\s*\{[^}]*translateX\(var\(--dsh-settings-swipe-x, 0\)\)/s)
  expect(css).toMatch(/\.options\s*\{[^}]*opacity: var\(--dsh-settings-swipe-opacity, 1\)/s)
  expect(css).toMatch(/\.options\s*\{[^}]*touch-action: pan-y;/s)
  expect(css).toMatch(/\.options\[data-swiping\]/)
})
