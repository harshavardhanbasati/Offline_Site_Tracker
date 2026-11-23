import { test, expect } from '@playwright/test'

test('inspector can log in and open offline-ready views', async ({ page, context }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill('inspector@fieldsync.com')
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Offline')).toBeVisible()
  await context.setOffline(false)
})

test('new inspector can register and reach the overview', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()

  await page.getByLabel('Full name').fill('Playwright Inspector')
  await page.getByLabel('Email address').fill(`playwright-${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByLabel('Confirm password').fill('password123')
  await page.getByText('Inspector', { exact: true }).click()
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('inspector', { exact: true })).toBeVisible()
})
