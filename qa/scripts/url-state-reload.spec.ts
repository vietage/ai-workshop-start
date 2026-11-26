import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, selectedName } from './helpers.ts';

const INVOICES = 'modules/billing/.claude/skills/invoices/SKILL.md';

test('url-state-reload: Reload keeps the repository, the skill and the filter', async ({ page }) => {
  await test.step('Scan fixture/, filter "the  way", click invoices', async () => {
    await scanFromPage(page, FIXTURE);
    await page.getByRole('searchbox', { name: 'Filter skills' }).fill('the  way');
    await page.locator('#skills li', { hasText: 'invoices' }).click();
  });
  await test.step('The URL keeps all three', () => {
    const params = new URL(page.url()).searchParams;
    expect(params.get('repo')).toBe(FIXTURE);
    expect(params.get('skill')).toBe(INVOICES);
    expect(params.get('filter')).toBe('the way');
  });
  await test.step('Reload shows the same', async () => {
    await page.reload();
    await expect(page.locator('#repo')).toHaveValue(FIXTURE);
    await expect(page.getByRole('searchbox', { name: 'Filter skills' })).toHaveValue('the way');
    await expect(page.locator('#summary')).toHaveText('fixture · 2 of 4 skills');
    await expect(selectedName(page)).toHaveText('invoices');
    await expect(page.locator('#skill h2')).toHaveText('invoices');
  });
});
