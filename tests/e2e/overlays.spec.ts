import { expect, test, type Page } from '@playwright/test'
import { open } from './site'

/**
 * The project dialog, driven from the keyboard.
 *
 * It used to be a dialog in name only: Tab walked straight out of it into the
 * page underneath, which was still scrolling-locked and half-hidden behind the
 * backdrop. These hold it to what a modal promises.
 */

/** Where focus is, as something a failure message can show. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'body'
    return `${el.closest('[role="dialog"]') ? 'dialog' : 'page'}:${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}`
  })

async function openProject(page: Page, title: string) {
  const card = page.getByRole('button', { name: `${title} — Details` })
  await card.scrollIntoViewIfNeeded()
  await card.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Focus moves in on its own, to the close button.
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  return { card, dialog }
}

test('the project dialog keeps Tab inside itself', async ({ page }) => {
  await open(page, '/?lang=en')
  const { dialog } = await openProject(page, 'Torex Local Storage')

  // Two stops in this dialog: the close button and the GitHub link.
  const stops: string[] = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    stops.push(await focused(page))
  }
  expect(stops.every((stop) => stop.startsWith('dialog:')), stops.join(' | ')).toBe(true)
  // It went round: both controls were reached, the first more than once.
  expect(new Set(stops).size).toBe(2)
  await expect(dialog.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/To-Rex/newtorexstore')

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await focused(page)).toMatch(/^dialog:/)
  }
})

test('a dialog with a single control keeps focus on it', async ({ page }) => {
  await open(page, '/?lang=en')
  const { dialog } = await openProject(page, 'MX Agent')
  for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  }
})

test('the page behind an open dialog is inert, and comes back when it closes', async ({ page }) => {
  await open(page, '/?lang=en')
  const outside = [page.locator('header'), page.locator('section#about'), page.locator('footer'), page.locator('a[href="#main"]')]
  const { card, dialog } = await openProject(page, 'Torex Local Storage')

  for (const part of outside) await expect(part).toHaveAttribute('inert', '')
  // The section holding the dialog cannot be inert, or the dialog would be.
  await expect(page.locator('section#projects')).not.toHaveAttribute('inert', '')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  for (const part of outside) await expect(part).not.toHaveAttribute('inert', '')
  // …and focus goes back to the card that opened it, not to the top of the page.
  await expect(card).toBeFocused()
})

test('the dialog closes from its button and from the backdrop', async ({ page }) => {
  await open(page, '/?lang=en')

  const first = await openProject(page, 'Torex Local Storage')
  await first.dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(first.dialog).toBeHidden()

  const second = await openProject(page, 'Torex Local Storage')
  // A corner of the viewport is backdrop, whatever the size of the panel.
  await page.mouse.click(4, 4)
  await expect(second.dialog).toBeHidden()
  await expect(page.locator('header')).not.toHaveAttribute('inert', '')
})

test('a described project shows its description, a pending one says so', async ({ page }) => {
  await open(page, '/?lang=en')

  const described = await openProject(page, 'Torex Local Storage')
  await expect(described.dialog).toContainText('embedded key-value storage engine for Flutter')
  for (const tech of ['Flutter', 'Dart', 'Rust', 'flutter_rust_bridge']) await expect(described.dialog.getByRole('listitem').filter({ hasText: new RegExp(`^${tech}$`) })).toBeVisible()
  await expect(described.dialog).not.toContainText('coming soon')
  await page.keyboard.press('Escape')
  await expect(described.dialog).toBeHidden()

  // Nothing is invented for a project that has not been written up yet.
  const pending = await openProject(page, 'MX Agent')
  await expect(pending.dialog.getByRole('link')).toHaveCount(0)
  await expect(pending.dialog.getByRole('listitem')).toHaveCount(0)
})
