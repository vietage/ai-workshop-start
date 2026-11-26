import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage } from './helpers.ts';

const PATH = 'modules/billing/.claude/skills/invoices/SKILL.md';

test('select-skill: Select a skill to see its SKILL.md', async ({ page }) => {
  await test.step('Scan fixture/', () => scanFromPage(page, FIXTURE));
  await test.step('Click invoices', () => page.locator('#skills li', { hasText: 'invoices' }).click());
  await test.step('Only invoices is selected', async () => {
    await expect(page.locator('#skills li[aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('#skills li[aria-selected="true"] .name')).toHaveText('invoices');
  });
  await test.step('Its SKILL.md and link are shown', async () => {
    await expect(page.locator('#skill h2')).toHaveText('invoices');
    await expect(page.locator('#skill a')).toHaveAttribute('href', new RegExp(`/fixture/${PATH.replace(/\./g, '\\.')}$`));
    await expect(page.locator('#content')).toContainText(/^---\n/);
    await expect(page.locator('#content')).toContainText('Create invoices the way the billing module does.');
  });
  await test.step('The URL keeps the skill', async () => {
    expect(new URL(page.url()).searchParams.get('skill')).toBe(PATH);
  });
});
