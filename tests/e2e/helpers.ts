import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export const fixtureA = resolve('tests/fixtures/page-a.jpg');
export const fixtureB = resolve('tests/fixtures/page-b.jpg');

export async function importPage(page: Page, file = fixtureA, bw = false) {
  await page.getByLabel('Choose a document photo').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Give it a clean edge.' })).toBeVisible();
  if (bw) await page.getByRole('radio', { name: /Black & white/ }).click();
  await page.getByRole('button', { name: 'Use this page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make it official.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Selected scanned page' })).toBeVisible();
}

export async function saveOnePage(page: Page, name = 'Offline receipt', folder = 'receipts') {
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await importPage(page);
  await page.getByLabel('Document name', { exact: true }).fill(name);
  await page.getByLabel('Save in folder').selectOption(folder);
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('button', { name: `Open document ${name}`, exact: true })).toBeVisible();
}

export async function installAndroidBridge(page: Page, options: { denied?: boolean; missingShare?: boolean; nativeSave?: 'saved' | 'cancelled' | 'unavailable' | 'error' } = {}) {
  // Load the actual bridge runtime shipped in @capacitor/android. Only its OS
  // transport is simulated; plugin serialization and JS registration are real.
  const nativeBridge = await readFile('node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'utf8');
  const headers = [
    { name: 'CameraAccess', methods: [{ name: 'request', rtype: 'promise' }] },
    { name: 'Filesystem', methods: ['writeFile', 'appendFile', 'deleteFile'].map(name => ({ name, rtype: 'promise' })) },
    ...(options.nativeSave ? [{ name: 'PdfSave', methods: [{ name: 'save', rtype: 'promise' }] }] : []),
    ...(!options.missingShare ? [{ name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] }] : []),
    { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }, { name: 'minimizeApp', rtype: 'promise' }] },
  ];
  await page.addInitScript({ content: `
    window.__nativeCalls = [];
    window.__nativeListeners = [];
    window.__nativeFailWrite = false;
    window.Capacitor = { PluginHeaders: ${JSON.stringify(headers)}, isLoggingEnabled: false };
    window.androidBridge = {
      postMessage(message) {
        const call = JSON.parse(message);
        window.__nativeCalls.push(call);
        if (call.methodName === 'addListener') { window.__nativeListeners.push(call); return; }
        if (call.methodName === 'removeListener') {
          window.__nativeListeners = window.__nativeListeners.filter(item => item.callbackId !== call.options.callbackId);
        }
        let data = {};
        let error;
        if (call.pluginId === 'CameraAccess') data = { state: '${options.denied ? 'denied' : 'granted'}' };
        if (call.pluginId === 'Filesystem') {
          if (window.__nativeFailWrite) error = { message: 'The device cache is full. Free up space and try again.' };
          else data = { uri: 'file:///data/user/0/app.scanandorganize.documents/cache/' + call.options.path };
        }
        if (call.pluginId === 'PdfSave') {
          if ('${options.nativeSave}' === 'error') error = { message: 'Saving files is restricted by this profile. Your scan is still saved.' };
          else data = { status: '${options.nativeSave || 'unavailable'}' };
        }
        if (call.pluginId === 'Share') data = { activityType: 'android' };
        queueMicrotask(() => window.Capacitor.fromNative({ callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName, success: !error, data, error }));
      }
    };
    window.__fireNativeEvent = (name, data) => {
      for (const call of window.__nativeListeners.filter(item => item.options.eventName === name)) {
        window.Capacitor.fromNative({ callbackId: call.callbackId, pluginId: 'App', methodName: 'addListener', success: true, data, save: true });
      }
    };
    ${nativeBridge}
  ` });
}

export async function serveBundledAssetsWithoutNetwork(page: Page) {
  const root = resolve('out');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3000') throw new Error(`Unexpected external request: ${url.origin}`);
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + '/')) return route.abort();
    try { await route.fulfill({ status: 200, contentType: types[extname(file)] || 'application/octet-stream', body: await readFile(file) }); }
    catch { await route.fulfill({ status: 404, body: 'Not found in bundled assets' }); }
  });
  await page.context().setOffline(true);
}
