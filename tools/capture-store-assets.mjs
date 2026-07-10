#!/usr/bin/env node
/**
 * Capture Chrome Web Store screenshot candidates.
 * Usage: node tools/capture-store-assets.mjs
 * Requires: Google Chrome, npm install, npm run fetch-deps (optional)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { unpackedExtensionId } from './extension-id.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'store-assets');
const article = path.join(root, 'tests/fixtures/article.html');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-store-cap-'));
const launchOptions = {
  channel: 'chrome',
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
  ],
};
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;

const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
const extensionId = unpackedExtensionId(root);

try {
  const articlePage = await context.newPage();
  await articlePage.setViewportSize({ width: 1280, height: 800 });
  await articlePage.goto(`file://${article}`);
  await articlePage.waitForFunction(() => window.__voxReaderLoaded === true, null, { timeout: 15_000 });
  await articlePage.keyboard.press('Alt+p');
  await articlePage.locator('#vox-player').waitFor({ state: 'visible', timeout: 10_000 });
  await articlePage.screenshot({ path: path.join(outDir, '01-player-article.png') });
  console.log('Saved store-assets/01-player-article.png');

  await articlePage.locator('#vox-settings-btn').click();
  await articlePage.waitForTimeout(300);
  await articlePage.screenshot({ path: path.join(outDir, '02-settings-export.png') });
  console.log('Saved store-assets/02-settings-export.png');

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 520 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(outDir, '03-popup.png') });
  console.log('Saved store-assets/03-popup.png');
} catch (err) {
  console.error('Capture failed:', err.message);
  console.error('Ensure Chrome is installed and the extension loads in a persistent context.');
  process.exit(1);
} finally {
  await context.close();
}

console.log('Done. Review images in store-assets/');
