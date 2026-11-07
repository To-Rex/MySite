import { expect, test, type Page } from '@playwright/test'
import { open } from './site'

/**
 * The full-screen menu on a phone. Runs in the `mobile` project only: the menu
 * and its button do not exist above the `lg` breakpoint.
 *
 * It is a dialog whose close button lives outside it, in the header — so the
 * keyboard has to be held in *two* places at once, and the rest of the page
 * switched off around them.
 */

const where = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (el?.closest('#mobile-menu')) return 'menu'
    if (el?.closest('header')) return 'header'
    return 'elsewhere'
  })

test('opens, takes focus, and closes on Escape back to its button', async ({ page }) => {
  await open(page, '/?lang=en')
  const toggle = page.locator('header button[aria-controls="mobile-menu"]')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  const menu = page.locator('#mobile-menu')
  await expect(menu).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAccessibleName('Close menu')
  // Focus moves into the menu once the links have slid in.
  await expect(menu.getByRole('link', { name: /Home/ })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('keeps Tab inside the header and the menu, round and round', async ({ page }) => {
  await open(page, '/?lang=en')
  await page.locator('header button[aria-controls="mobile-menu"]').click()
  const menu = page.locator('#mobile-menu')
  await expect(menu.getByRole('link', { name: /Home/ })).toBeFocused()

  // More presses than there are controls, so the loop has to close at least once.
  const visited: string[] = []
  for (let i = 0; i < 28; i++) {
    await page.keyboard.press('Tab')
    visited.push(await where(page))
  }
  expect(visited.filter((place) => place === 'elsewhere')).toEqual([])
  // Both halves are in the loop: the header holds the button that closes this.
  expect(new Set(visited)).toEqual(new Set(['menu', 'header']))

  // And backwards, across the seam from the first control to the last.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await where(page)).not.toBe('elsewhere')
  }
})

test('switches the page off behind it, but not the header', async ({ page }) => {
  await open(page, '/?lang=en')
  const toggle = page.locator('header button[aria-controls="mobile-menu"]')
  await toggle.click()
  await expect(page.locator('#mobile-menu')).toBeVisible()

  await expect(page.locator('main#main')).toHaveAttribute('inert', '')
  await expect(page.locator('footer')).toHaveAttribute('inert', '')
  await expect(page.locator('header')).not.toHaveAttribute('inert', '')

  // The header's own button still works — it is the way out.
  await toggle.click()
  await expect(page.locator('#mobile-menu')).toBeHidden()
  await expect(page.locator('main#main')).not.toHaveAttribute('inert', '')
})

test('a link in the menu closes it and goes to its section', async ({ page }) => {
  await open(page, '/?lang=en')
  await page.locator('header button[aria-controls="mobile-menu"]').click()
  await page.locator('#mobile-menu').getByRole('link', { name: /Projects/ }).click()

  await expect(page.locator('#mobile-menu')).toBeHidden()
  await expect(page.locator('main#main')).not.toHaveAttribute('inert', '')
  await expect(page.locator('#projects-title')).toBeInViewport()
})

test('widening the window past the breakpoint lets the page go', async ({ page }) => {
  await open(page, '/?lang=en')
  await page.locator('header button[aria-controls="mobile-menu"]').click()
  await expect(page.locator('main#main')).toHaveAttribute('inert', '')

  // The menu is display:none from here up. Its state used to stay behind, with
  // the page locked and — once the trap existed — inert under an invisible menu.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('main#main')).not.toHaveAttribute('inert', '')
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')

  // And it does not spring back open when the window narrows again.
  await page.setViewportSize({ width: 412, height: 839 })
  await expect(page.locator('#mobile-menu')).toHaveCount(0)
})
