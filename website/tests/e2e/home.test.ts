import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    
    // Verify the page loaded successfully
    await expect(page).toHaveTitle(/All Things Web/);
  });
});
