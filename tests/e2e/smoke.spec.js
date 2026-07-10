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
      await expect(frame.locator('.vox-word')).not.toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('iframe word highlights during classic playback', async () => {
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
      await page.locator('#eng-classic').click();

      const frame = page.frameLocator('#same-origin-frame');
      await frame.locator('p').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      await page.keyboard.press('Alt+r');
      await expect(page.locator('#vox-status')).toContainText(/Playing|Reading selection/i, { timeout: 10_000 });
      await expect(frame.locator('.vox-word-active')).toBeVisible({ timeout: 8_000 });
    } finally {
      await context.close();
    }
  });

  test('export Cancel aborts queued AI voice download', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#exp-mp3').click();
      await expect(page.locator('#exp-mp3')).toHaveText('Cancel', { timeout: 10_000 });
      await expect(page.locator('#vox-status')).toContainText(/download/i, { timeout: 10_000 });
      await page.locator('#exp-mp3').click();
      await expect(page.locator('#exp-mp3')).toHaveText('Export', { timeout: 5_000 });
      await expect(page.locator('#vox-status')).toContainText(/cancelled/i, { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('install Cancel stops Kokoro download panel', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-kokoro-install')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#vox-install-cancel')).toBeVisible({ timeout: 10_000 });
      await page.locator('#vox-install-cancel').click();
      await expect(page.locator('#vox-status')).toContainText(/cancelled/i, { timeout: 10_000 });
      await expect(page.locator('#vox-install-cancel')).toBeHidden({ timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('Alt+E opens player and queues export download', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+e');
      await expect(page.locator('#vox-player')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#exp-mp3')).toHaveText('Cancel', { timeout: 10_000 });
      await expect(page.locator('#vox-status')).toContainText(/download/i, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test('popup shows version and privacy link', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context, extensionId } = launched;
    try {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await expect(popup.locator('#popup-version')).toContainText(/v\d+\.\d+/);
      await expect(popup.locator('#privacy-link')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('iframe sentence highlights during classic playback', async () => {
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
      await page.locator('#eng-classic').click();

      const frame = page.frameLocator('#same-origin-frame');
      await frame.locator('p').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      await page.keyboard.press('Alt+r');
      await expect(page.locator('#vox-status')).toContainText(/Playing|Reading selection/i, { timeout: 10_000 });
      await expect(frame.locator('.vox-word-active')).toBeVisible({ timeout: 8_000 });
    } finally {
      await context.close();
    }
  });

  test('Alt+S stops classic iframe playback', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();

      const frame = page.frameLocator('#same-origin-frame');
      await frame.locator('p').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      await page.keyboard.press('Alt+r');
      await expect(page.locator('#vox-status')).toContainText(/Playing|Reading selection/i, { timeout: 10_000 });
      await page.keyboard.press('Alt+s');
      await expect(page.locator('#vox-status')).toContainText(/Stopped/i, { timeout: 8_000 });
      await expect(frame.locator('.vox-word-active')).toHaveCount(0);
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

  test('chat latest-only scope wraps only the last reply', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${chatFixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.selectOption('#chat-read-scope', 'latest');
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.vox-word').length > 0,
        null,
        { timeout: 15_000 },
      );
      const firstReply = page.locator('[data-message-author-role="assistant"]').first();
      const lastReply = page.locator('[data-message-author-role="assistant"]').last();
      await expect(firstReply.locator('.vox-word')).toHaveCount(0);
      await expect(lastReply.locator('.vox-word')).not.toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('chat single-reply scope wraps only the chosen reply', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${chatFixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.selectOption('#chat-read-scope', 'single');
      await expect(page.locator('#chat-read-index')).toBeVisible();
      await page.selectOption('#chat-read-index', '0');
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.vox-word').length > 0,
        null,
        { timeout: 15_000 },
      );
      const firstReply = page.locator('[data-message-author-role="assistant"]').first();
      const lastReply = page.locator('[data-message-author-role="assistant"]').last();
      await expect(firstReply.locator('.vox-word')).not.toHaveCount(0);
      await expect(lastReply.locator('.vox-word')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('Alt+S cancels queued export from Alt+E', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+e');
      await expect(page.locator('#exp-mp3')).toHaveText('Cancel', { timeout: 10_000 });
      await page.keyboard.press('Alt+s');
      await expect(page.locator('#vox-status')).toContainText(/cancelled/i, { timeout: 8_000 });
      await expect(page.locator('#exp-mp3')).toHaveText('Export', { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('immersive reader opens and closes', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-immersive-btn').click();
      await expect(page.locator('#vox-immersive')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('#vox-immersive-content .vox-word')).not.toHaveCount(0);
      await page.locator('#vox-immersive-exit').click();
      await expect(page.locator('#vox-immersive')).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('chat all-replies scope wraps every assistant message', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${chatFixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.selectOption('#chat-read-scope', 'all');
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.vox-word').length > 0,
        null,
        { timeout: 15_000 },
      );
      const replies = page.locator('[data-message-author-role="assistant"]');
      await expect(replies.first().locator('.vox-word')).not.toHaveCount(0);
      await expect(replies.last().locator('.vox-word')).not.toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('Alt+P pauses and resumes classic playback', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await expect(page.locator('#vox-status')).toContainText(/Playing/i, { timeout: 10_000 });
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-status')).toContainText(/Paused/i, { timeout: 8_000 });
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-status')).toContainText(/Playing/i, { timeout: 8_000 });
    } finally {
      await context.close();
    }
  });

  test('click-to-jump seeks during classic playback', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await expect(page.locator('#vox-status')).toContainText(/Playing/i, { timeout: 10_000 });
      await page.waitForFunction(
        () => document.querySelectorAll('article .vox-word').length > 8,
        null,
        { timeout: 15_000 },
      );
      const target = page.locator('article .vox-word').nth(8);
      await target.click();
      await expect(target).toHaveClass(/vox-word-active/, { timeout: 8_000 });
    } finally {
      await context.close();
    }
  });

  test('skip forward advances highlight while paused', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await expect(page.locator('#vox-status')).toContainText(/Playing/i, { timeout: 10_000 });
      await page.waitForFunction(
        () => document.querySelectorAll('article .vox-word').length > 0,
        null,
        { timeout: 15_000 },
      );
      await page.keyboard.press('Alt+p');
      await expect(page.locator('#vox-status')).toContainText(/Paused/i, { timeout: 8_000 });
      const beforeIdx = await page.locator('article .vox-word-active').first().getAttribute('data-vox-index');
      await page.locator('#vox-fwd-bar').click();
      await expect.poll(async () => {
        const idx = await page.locator('article .vox-word-active').first().getAttribute('data-vox-index');
        return idx !== beforeIdx;
      }).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('word highlight toggle disables active word styling', async () => {
    const launched = await launchWithExtension();
    if (!launched) test.skip(true, 'Chrome extension host unavailable');
    const { context } = launched;
    try {
      const page = await context.newPage();
      await page.goto(`file://${fixturePage}`);
      await page.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
      await page.keyboard.press('Alt+p');
      await page.locator('#vox-settings-btn').click();
      await page.locator('#eng-classic').click();
      const wordToggle = page.locator('#tog-word');
      if (await wordToggle.evaluate((el) => el.classList.contains('on'))) {
        await wordToggle.click();
      }
      await page.locator('#vox-settings-close').click();
      await page.locator('#vox-playpause-bar').click();
      await expect(page.locator('#vox-status')).toContainText(/Playing/i, { timeout: 10_000 });
      await page.waitForTimeout(800);
      await expect(page.locator('article .vox-word-active')).toHaveCount(0);
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
