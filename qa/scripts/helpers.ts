// What the scripts share: the fixture repository, and scanning it from the page.
import { expect, type Page } from '@playwright/test';
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

export { expect };
