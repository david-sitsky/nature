const { test, expect } = require('@playwright/test');

test.describe('Bogong Moth Visualizer', () => {
  test('loads without errors and UI elements appear', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    
    await page.goto('/bogong.html');
    
    // Wait for the loading overlay to disappear
    await page.waitForSelector('#loading-overlay.hidden', { state: 'attached', timeout: 15000 });
    
    // Check if map container exists
    const map = page.locator('#map-container');
    await expect(map).toBeVisible();

    // Check if the Bogong Moth right panel is visible
    const rightPanel = page.locator('.species-panel');
    await expect(rightPanel).toBeVisible();
    await expect(rightPanel).toContainText('Bogong Moth');
    await expect(rightPanel).toContainText('Agrotis infusa');

    // Ensure no JS errors occurred
    expect(errors.length).toBe(0);
  });
});
