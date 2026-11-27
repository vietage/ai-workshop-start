import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, screenshot, skillNames } from './helpers.ts';

test('filter-skills: Filter the skills as you type', async ({ page }) => {
  await test.step('Scan fixture/', () => scanFromPage(page, FIXTURE));
  await expect(page.locator('#summary')).toHaveText('fixture · 4 skills');
  const scans: string[] = [];
  page.on('request', (request) => request.url().includes('/api/scan') && scans.push(request.url()));
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });

  await test.step('Type "BILLING invoices": only invoices, in any case', async () => {
    await filter.pressSequentially('BILLING invoices');
    await expect(page.locator('#summary')).toHaveText('fixture · 1 of 4 skills');
    expect(await skillNames(page)).toEqual(['invoices']);
    expect(new URL(page.url()).searchParams.get('filter')).toBe('BILLING invoices');
    await screenshot(page, 'filter-skills-one-match');
  });
  await test.step('Type "way commit": words in any order', async () => {
    await filter.fill('way commit');
    await expect(page.locator('#summary')).toHaveText('fixture · 1 of 4 skills');
    expect(await skillNames(page)).toEqual(['commits']);
  });
  await test.step('Type "no-such-skill": no match, not an error', async () => {
    await filter.fill('no-such-skill');
    await expect(page.locator('#no-match')).toHaveText('no skills match "no-such-skill"');
    await expect(page.locator('#skills li')).toHaveCount(0);
    await expect(page.locator('#error')).toBeEmpty();
    await screenshot(page, 'filter-skills-no-match');
  });
  await test.step('Clear the filter: all the skills again', async () => {
    await filter.fill('');
    await expect(page.locator('#summary')).toHaveText('fixture · 4 skills');
    await expect(page.locator('#skills li')).toHaveCount(4);
    expect(new URL(page.url()).searchParams.has('filter')).toBe(false);
  });
  await test.step('Filtering did not scan again', () => {
    expect(scans).toEqual([]);
  });
});
