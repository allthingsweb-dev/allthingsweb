import { test, expect } from "@playwright/test";

test.describe("About Page", () => {
  test("should load about page with content", async ({ page }) => {
    await page.goto("/about");

    // Verify page title
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Verify we stay on the about page
    await expect(page).toHaveURL(/.*about$/);
  });
});
