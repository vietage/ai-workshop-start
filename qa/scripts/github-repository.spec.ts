import { test } from '@playwright/test';
import { expect, scanFromPage } from './helpers.ts';

const COMMIT = '709079e4a34d6c9234583352550e6a2b88a0bb85';

test('github-repository: Scan a GitHub repository at a commit', async ({ page }) => {
  test.skip(process.env.QA_OFFLINE === '1', 'QA_OFFLINE=1: needs the network');
  await test.step('Scan JetBrains/koog at a commit', () =>
    scanFromPage(page, `https://github.com/JetBrains/koog/tree/${COMMIT}`));
  await test.step('The header shows the repository and the commit', async () => {
    await expect(page.locator('#summary')).toHaveText(/^JetBrains\/koog · \d+ skills? · 709079e4a34d$/, { timeout: 20_000 });
    expect(await page.locator('#skills li').count()).toBeGreaterThan(0);
  });
  await test.step('The first skill links to the commit', async () => {
    await page.locator('#skills li').first().click();
    await expect(page.locator('#skill a')).toHaveAttribute('href', new RegExp(`^https://github\\.com/JetBrains/koog/blob/${COMMIT}/.+/SKILL\\.md$`));
  });
});
