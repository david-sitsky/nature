const { test, expect } = require('@playwright/test');

test.describe('FrogID Audio Bug', () => {
  test('orchestra stops when filter applied and sound stops when paused', async ({ page }) => {
    await page.goto('/frogid.html');
    await page.waitForSelector('#loading-overlay.hidden', { state: 'attached', timeout: 15000 });
    
    // Evaluate in page to inspect audio elements
    await page.evaluate(() => {
      window.app.audio.setSoundEnabled(true);
      window.app.audio.setPlaying(true);
    });

    // Check if orchestra is playing
    let isOrchPlaying = await page.evaluate(() => !window.app.audio.orchestraAudio.paused);
    expect(isOrchPlaying).toBe(true);

    // Apply a filter manually
    await page.evaluate(() => {
      const idx = window.app.data.speciesData.findIndex(s => s.commonName === "Peron's Tree Frog");
      window.app._addFilter(window.app.data.speciesData[idx]);
    });

    // Wait a tick
    await page.waitForTimeout(500);

    // Filter audio should be playing
    let isFilterPlaying = await page.evaluate(() => {
      for (const a of window.app.audio.filterAudios.values()) {
        if (!a.paused) return true;
      }
      return false;
    });
    expect(isFilterPlaying).toBe(true);

    // Orchestra should be stopped!
    isOrchPlaying = await page.evaluate(() => !window.app.audio.orchestraAudio.paused);
    expect(isOrchPlaying).toBe(false);

    // Now pause animation
    await page.evaluate(() => {
      window.app._pause();
    });

    // Everything should stop
    isFilterPlaying = await page.evaluate(() => {
      for (const a of window.app.audio.filterAudios.values()) {
        if (!a.paused) return true;
      }
      return false;
    });
    expect(isFilterPlaying).toBe(false);
  });
});
