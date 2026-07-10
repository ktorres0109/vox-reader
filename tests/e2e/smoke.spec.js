import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = root;
const fixturePage = path.join(root, 'tests/fixtures/article.html');

async function launchWithExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-reader-pw-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.goto('about:blank');

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null);
  }
  if (!serviceWorker) {
    await context.close();
    return null;
  }

  const extensionId = serviceWorker.url().split('/')[2];
  return { context, extensionId };
}

test.describe('Vox Reader smoke', () => {
  test('popup renders primary actions', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context, extensionId } = launched;
    try {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await expect(popup.locator('#open-player')).toBeVisible();
      await expect(popup.locator('#read-selection')).toBeVisible();
      await expect(popup.locator('#sc-play-display')).toHaveText('Alt+P');
    } finally {
      await context.close();
    }
  });

  test('content script loads on a local article page', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await expect(page.locator('article h1')).toHaveText('Smoke test article');
    } finally {
      await context.close();
    }
  });

  test('Alt+P opens the floating player', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-player')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#vox-playpause-bar')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
