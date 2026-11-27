import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, screenshot } from './helpers.ts';

const MISSING = '/no/such/directory';

test('failed-scan: A failed scan shows its message and nothing else', async ({ page }) => {
  await test.step('Scan fixture/', async () => {
    await scanFromPage(page, FIXTURE);
    await expect(page.locator('#skills li')).toHaveCount(4);
  });
  let message = '';
  await test.step('Scan a directory that does not exist', async () => {
    await page.locator('#repo').fill(MISSING);
    await page.getByRole('button', { name: 'Scan' }).click();
    await expect(page.locator('#error')).not.toBeEmpty();
    message = (await page.locator('#error').textContent()) ?? '';
    await expect(page.locator('#main')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Scan' })).toBeEnabled();
    await screenshot(page, 'failed-scan-message');
  });
  await test.step('Reload shows the same message', async () => {
    expect(new URL(page.url()).searchParams.get('repo')).toBe(MISSING);
    await page.reload();
    await expect(page.locator('#error')).toHaveText(message);
    await expect(page.locator('#main')).toBeHidden();
    await screenshot(page, 'failed-scan-after-reload');
  });
});
