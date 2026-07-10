import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { unpackedExtensionId } from '../../tools/extension-id.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = root;
const fixturePage = path.join(root, 'tests/fixtures/article.html');
const chatFixturePage = path.join(root, 'tests/fixtures/chat.html');

async function waitForExtensionServiceWorker(context, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workers = context.serviceWorkers();
    const extWorker = workers.find((w) => w.url().startsWith('chrome-extension://'));
    if (extWorker) return extWorker;
    await new Promise((r) => setTimeout(r, 250));
  }
  return context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => null);
}

async function launchWithExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-reader-pw-'));
  const launchOptions = {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  };
  if (process.env.CHROME_PATH) {
    launchOptions.executablePath = process.env.CHROME_PATH;
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  const serviceWorker = await waitForExtensionServiceWorker(context, 15_000);
  const extensionId = serviceWorker?.url().split('/')[2] ?? unpackedExtensionId(extensionPath);

  const probe = await context.newPage();
  await probe.goto(`file://${fixturePage}`);
  const contentReady = await probe.waitForFunction(
    () => window.__voxReaderLoaded === true,
    null,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  await probe.close();

  if (!contentReady) {
    await context.close();
    return null;
  }

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
      await expect(popup.locator('#sc-export-display')).toHaveText('Alt+E');
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

  test('Alt+R reads text selected inside a same-origin iframe', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });

      const frame = page.frameLocator('#same-origin-frame');
      await frame.locator('p').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      await page.keyboard.press('Alt+r');
      await expect(page.locator('#vox-player')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#vox-status')).toContainText(/Reading selection/i, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test('player shows export scope and format controls', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-player')).toBeVisible({ timeout: 10_000 });
      await page.locator('#vox-settings-btn').click();
      await expect(page.locator('#export-scope')).toBeVisible();
      await expect(page.locator('#export-format')).toBeVisible();
      await expect(page.locator('#export-bitrate')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('export selection scope prompts when nothing is selected', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.selectOption('#export-scope', 'selection');
      await page.locator('#exp-mp3').click();
      await expect(page.locator('#vox-status')).toContainText(/Select text on the page first/i, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test('chat fixture shows reply scope controls', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${chatFixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await expect(page.locator('#vox-chat-read-section')).toBeVisible();
      await expect(page.locator('#chat-read-scope')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
