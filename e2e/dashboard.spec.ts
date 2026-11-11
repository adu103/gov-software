import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

const sourceType = JSON.parse(readFileSync('src/generated/snapshot.json', 'utf8')).meta.sourceType

test('production page works under the project subpath without source requests', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) externalRequests.push(request.url())
  })
  await page.goto('/gov-software/')
  await expect(page.getByText(sourceType === 'synthetic' ? 'Demo data only — not actual government data' : 'Manually imported snapshot — not live data')).toBeVisible()
  await expect(page.getByRole('table', { name: /Agency funding/ })).toBeVisible()
  await expect(page.getByRole('table', { name: /Funding for matching snapshot records/ })).toBeVisible()
  await page.getByLabel('Search title or UII').fill('no matching investment exists')
  await expect(page.getByRole('status')).toContainText('No records match')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible()
  expect(externalRequests).toEqual([])
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} layout is accessible at mobile width`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme })
    await page.goto('/gov-software/')
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus-visible')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
}
