import { Page, expect } from '@playwright/test';

/**
 * Common utilities for e2e tests
 */

/**
 * Wait for navigation to complete and verify the URL
 */
export async function expectNavigation(page: Page, expectedPath: string) {
  await expect(page).toHaveURL(new RegExp(expectedPath));
}

/**
 * Check if an element is visible on the page
 */
export async function expectVisible(page: Page, selector: string) {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
  return element;
}

/**
 * Helper to fill out forms
 */
export async function fillForm(page: Page, formData: Record<string, string>) {
  for (const [selector, value] of Object.entries(formData)) {
    await page.fill(selector, value);
  }
}
