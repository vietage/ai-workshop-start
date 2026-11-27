import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, screenshot, selectedName, skillNames } from './helpers.ts';

test('filter-moves-selection: Filtering out the selected skill selects the first match', async ({ page }) => {
  await test.step('Scan fixture/ and click commits', async () => {
    await scanFromPage(page, FIXTURE);
    await page.locator('#skills li', { hasText: 'Write commit messages' }).click();
    await expect(selectedName(page)).toHaveText('commits');
  });
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  await test.step('Type "the way": commits stays selected', async () => {
    await filter.fill('the way');
    expect(await skillNames(page)).toEqual(['commits', 'invoices']);
    await expect(selectedName(page)).toHaveText('commits');
    await screenshot(page, 'filter-moves-selection-commits-kept');
  });
  await test.step('Type "the way billing": invoices is selected', async () => {
    await filter.fill('the way billing');
    expect(await skillNames(page)).toEqual(['invoices']);
    await expect(selectedName(page)).toHaveText('invoices');
    await expect(page.locator('#skill h2')).toHaveText('invoices');
    await screenshot(page, 'filter-moves-selection-invoices-selected');
  });
});
