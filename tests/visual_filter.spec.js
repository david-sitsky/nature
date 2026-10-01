const { test, expect } = require('@playwright/test');

test.describe('FrogID Visual Filter Tests', () => {
  test('applying a filter updates the map rendering', async ({ page }) => {
    await page.goto('/frogid.html');
    
    // Wait for the loading overlay to disappear
    await page.waitForSelector('#loading-overlay.hidden', { state: 'attached', timeout: 15000 });
    
    // Give the map a moment to fully render tiles
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the base map
    const beforeScreenshot = await page.locator('#map-container').screenshot();

    // Apply filter for Tree Frog
    await page.click('#filter-input');
    await page.fill('#filter-input', 'Tree Frog');
    await page.waitForSelector('#filter-dropdown .filter-option', { state: 'visible' });
    await page.click('#filter-dropdown .filter-option:nth-child(1)');

    // Wait for update
    await page.waitForTimeout(3000);

    // Take a screenshot after filtering
    const afterScreenshot = await page.locator('#map-container').screenshot();

    // The two screenshots MUST NOT be identical if the filter was applied correctly.
    // Playwright doesn't have a built-in not-to-match buffer assertion easily without plugins,
    // so let's just do a manual buffer compare
    if (beforeScreenshot.equals(afterScreenshot)) {
      throw new Error("Screen did not update after applying a filter!");
    }
  });
});
