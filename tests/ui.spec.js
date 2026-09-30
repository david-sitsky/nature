const { test, expect } = require('@playwright/test');

test.describe('FrogID UI Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/frogid.html');
    // Wait for the loading overlay to disappear
    await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
  });

  test('playback controls update scrubber and date', async ({ page }) => {
    // Initial state
    await expect(page.locator('#scrubber')).toHaveValue('0');
    
    // Click play
    await page.locator('#btn-play').click();
    
    // Wait for scrubber to advance
    await expect(page.locator('#scrubber')).not.toHaveValue('0', { timeout: 5000 });
    
    // Click rewind
    await page.locator('#btn-rewind').click();
    
    // Should be back to 0
    await expect(page.locator('#scrubber')).toHaveValue('0');
  });

  test('species filter dropdown shows correctly', async ({ page }) => {
    // Type in filter
    const input = page.locator('#filter-input');
    await input.click();
    await input.fill('Tree Frog');
    
    // Dropdown should appear and contain matches
    const dropdown = page.locator('#filter-dropdown');
    await expect(dropdown).not.toHaveClass(/hidden/);
    
    // Since we fixed the bug, "Green Tree Frog" should be visible in the results.
    const greenTreeFrog = page.getByText('Green Tree Frog', { exact: true });
    await expect(greenTreeFrog).toBeVisible();
    
    // Click a result to add a filter pill
    await greenTreeFrog.click();
    
    // Pill should be added
    const pills = page.locator('#filter-pills .filter-pill');
    await expect(pills).toHaveCount(1);
    await expect(pills.first()).toContainText('Green Tree Frog');
  });

  test('sound hint appears and is dismissible', async ({ page }) => {
    // Wait for the hint to appear (1s timeout in code)
    const hint = page.locator('#sound-hint');
    await expect(hint).not.toHaveClass(/hidden/, { timeout: 3000 });
    
    // Dismiss it. The hint has an infinite pulse animation, so we must force click
    // because Playwright will wait forever for it to become "stable".
    await page.locator('#sound-hint-close').click({ force: true });
    await expect(hint).toHaveClass(/hidden/);
  });
});
