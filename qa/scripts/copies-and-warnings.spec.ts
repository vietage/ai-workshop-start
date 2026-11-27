import { test } from '@playwright/test';
import { expect, FIXTURE, scanFromPage, screenshot } from './helpers.ts';

test('copies-and-warnings: Copies and warnings are shown', async ({ page }) => {
  await test.step('Scan fixture/', () => scanFromPage(page, FIXTURE));
  await test.step('Copies are listed with their skill', async () => {
    const item = (name: string) => page.locator('#skills li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(item('code-style').locator('.copies')).toHaveText('also in .github/skills/code-style/SKILL.md');
    await expect(item('commits').locator('.copies')).toHaveText('also in .github/skills/commits/SKILL.md');
  });
  await test.step('Two warnings under the skills', async () => {
    const warnings = page.locator('#warnings li');
    await expect(warnings).toHaveCount(2);
    await expect(warnings.nth(0)).toContainText('.agents/skills/release-checklist/SKILL.md: malformed front matter');
    await expect(warnings.nth(1)).toContainText('.claude/skills/commits/SKILL.md: its copies differ: .github/skills/commits/SKILL.md');
    await screenshot(page.locator('#list'), 'copies-and-warnings-list');
  });
});
