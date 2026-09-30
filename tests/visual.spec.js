const { test, expect } = require('@playwright/test');

test.describe('FrogID Visual Tests', () => {
  test('base map renders correctly', async ({ page }) => {
    await page.goto('/frogid.html');
    
    // Wait for the loading overlay to disappear
    await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
    
    // Give the map a moment to fully render tiles
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the map container
    await expect(page.locator('#map-container')).toHaveScreenshot('base-map-render.png', {
      maxDiffPixelRatio: 0.1,
    });
  });
});
