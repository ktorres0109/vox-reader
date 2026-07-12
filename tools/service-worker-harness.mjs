import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function eventSlot() {
  return {
    listener: null,
    addListener(listener) { this.listener = listener; },
  };
}

export function loadServiceWorker() {
  const sent = [];
  const installed = eventSlot();
  const contextClicked = eventSlot();
  const command = eventSlot();
  const runtimeMessage = eventSlot();
  const createdMenus = [];

  const chrome = {
    runtime: {
      onInstalled: installed,
      onMessage: runtimeMessage,
      getURL: (file) => `chrome-extension://test/${file}`,
      sendMessage: async () => {},
      lastError: null,
    },
    contextMenus: {
      onClicked: contextClicked,
      removeAll(callback) { callback(); },
      create(options) { createdMenus.push(options); },
    },
    commands: { onCommand: command },
    tabs: {
      async query() { return [{ id: 7 }]; },
      async sendMessage(tabId, message) { sent.push({ tabId, message }); },
    },
    scripting: {
      async executeScript() { return [{ frameId: 0, result: 'selected text' }]; },
      async insertCSS() {},
    },
    storage: {
      sync: { remove() {}, set() {} },
      local: { remove() {} },
      session: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    },
    offscreen: {
      async hasDocument() { return false; },
      async createDocument() {},
    },
    downloads: {
      download() {},
      onChanged: { addListener() {}, removeListener() {} },
    },
  };

  const sandbox = {
    chrome,
    importScripts() {},
    fetch: async () => ({ ok: true }),
    Blob: class Blob {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    setTimeout,
    clearTimeout,
    console,
  };
  const source = fs.readFileSync(path.join(root, 'background/service_worker.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'background/service_worker.js' });

  return {
    listeners: {
      installed: installed.listener,
      contextClicked: contextClicked.listener,
      command: command.listener,
      runtimeMessage: runtimeMessage.listener,
    },
    sent,
    createdMenus,
  };
}
