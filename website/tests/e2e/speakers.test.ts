import { test, expect } from '@playwright/test';

test.describe('Speakers Page', () => {
  test('should load speakers page with content', async ({ page }) => {
    await page.goto('/speakers');
    
    // Verify page title
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    
    // Verify speakers section is present
    const speakersSection = page.getByRole('main');
    await expect(speakersSection).toBeVisible();
    
    // Verify at least one speaker card is present
    const speakerCards = speakersSection.getByRole('listitem');
    await expect(speakerCards.first()).toBeVisible();
    
    // Verify we stay on the speakers page
    await expect(page).toHaveURL(/.*speakers$/);
  });
});
