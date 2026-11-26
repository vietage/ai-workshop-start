import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, selectedName, skillNames } from './helpers.ts';

test('scan-local-directory: Scan a local directory', async ({ page }) => {
  await test.step('Scan fixture/', () => scanFromPage(page, FIXTURE));
  await test.step('The header counts 4 skills', async () => {
    await expect(page.locator('#summary')).toHaveText('fixture · 4 skills');
  });
  await test.step('The skills are sorted by name', async () => {
    expect(await skillNames(page)).toEqual(['code-style', 'commits', 'invoices', 'release-checklist']);
  });
  await test.step('Each skill shows its path and first sentence', async () => {
    const commits = page.locator('#skills li', { hasText: 'commits' }).first();
    await expect(commits.locator('.path')).toHaveText('.claude/skills/commits/SKILL.md');
    await expect(commits.locator('.description')).toHaveText('Write commit messages the way this repository does.');
  });
  await test.step('The first skill is selected and shown', async () => {
    await expect(selectedName(page)).toHaveText('code-style');
    await expect(page.locator('#skill h2')).toHaveText('code-style');
    await expect(page.locator('#skill a')).toHaveAttribute('href', /^file:\/\/.*\/fixture\/\.claude\/skills\/code-style\/SKILL\.md$/);
    await expect(page.locator('#content')).toContainText('name: code-style');
  });
  await test.step('No error', async () => {
    await expect(page.locator('#error')).toBeEmpty();
  });
});
