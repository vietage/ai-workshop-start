// What the scripts share: the fixture repository, scanning it from the page, and the screenshots.
import { expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The tests' small repository, as a local directory: its skills are described in fixture/README.md. */
export const FIXTURE = fileURLToPath(new URL('../../fixture', import.meta.url));

/** Opens the page, enters `repo` in the repository field and presses Scan. */
export async function scanFromPage(page: Page, repo: string) {
  await page.goto('/');
  await page.locator('#repo').fill(repo);
  await page.getByRole('button', { name: 'Scan' }).click();
}

/** The names of the skills listed, in order. */
export const skillNames = (page: Page) => page.locator('#skills li .name').allTextContents();

/** The selected skill's name, in the list. */
export const selectedName = (page: Page) => page.locator('#skills li[aria-selected="true"] .name');

/**
 * A key moment of the scenario, a state a person would check: the page (or one part of it),
 * compared against `qa/screenshots/<name>.png` by `npm run e2e` (QA_SCREENSHOTS=1); `name` is
 * `<scenario id>-<moment>`.
 */
export async function screenshot(target: Page | Locator, name: string) {
  await expect(target).toHaveScreenshot(`${name}.png`);
}

export { expect };
