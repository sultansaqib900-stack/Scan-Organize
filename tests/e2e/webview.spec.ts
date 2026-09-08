import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { fixtureB, importPage, installAndroidBridge, saveOnePage, serveBundledAssetsWithoutNetwork } from './helpers';

interface NativeCall { pluginId: string; methodName: string; options: Record<string, unknown> }
interface NativeWindow { __nativeCalls: NativeCall[]; __nativeFailWrite: boolean; __fireNativeEvent: (name: string, data: object) => void }

test('first offline bundled load, touch corner drag, page reorder/swipe, IDB persistence and native PDF share transport', async ({ page }) => {
  await installAndroidBridge(page);
  await serveBundledAssetsWithoutNetwork(page);
  await page.goto('/');
  // The asset-loader harness fulfills every file from disk with transport offline.
  // navigator.onLine is intentionally not used by the app (unreliable in WebViews).
  await expect(page.getByText('Works offline', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Capture page', exact: true }).click();
  const corner = page.getByRole('button', { name: 'Top left crop corner', exact: true });
  const before = await corner.getAttribute('style');
  const bounds = await corner.boundingBox(); if (!bounds) throw new Error('Corner missing');
  const cdp = await page.context().newCDPSession(page);
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 25, y: start.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await corner.getAttribute('style')).not.toBe(before);
  await page.getByRole('button', { name: 'Use this page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make it official.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a page', exact: true }).click();
  await importPage(page, fixtureB, true);
  const ids = await page.locator('.draft-thumbnail').evaluateAll(elements => elements.map(e => e.getAttribute('data-page-id')));
  await page.getByRole('button', { name: 'Reorder page 1', exact: true }).scrollIntoViewIfNeeded();
  const first = await page.getByRole('button', { name: 'Reorder page 1', exact: true }).boundingBox();
  const second = await page.getByRole('button', { name: 'Reorder page 2', exact: true }).boundingBox();
  if (!first || !second) throw new Error('Reorder handles missing');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x + first.width / 2, y: first.y + first.height / 2 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: first.x + first.width / 2 + (second.x - first.x) * i / 10, y: first.y + first.height / 2 }] });
  await expect(page.getByRole('status').filter({ hasText: 'Moving page 1 to position 2.' })).toBeAttached();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.locator('.draft-thumbnail').evaluateAll(elements => elements.map(e => e.getAttribute('data-page-id')))).toEqual([...ids].reverse());
  await page.getByLabel('Document name', { exact: true }).fill('Android paperwork');
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open document Android paperwork', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open document Android paperwork', exact: true }).click();
  const gallery = await page.locator('.page-carousel').boundingBox(); if (!gallery) throw new Error('Gallery missing');
  const y = gallery.y + gallery.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gallery.x + gallery.width * .8, y }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gallery.x + gallery.width * (.8 - .6 * i / 12), y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.viewer-footer')).toContainText('Page 2 of 2');
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('native share sheet');
  const calls = await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls);
  const write = calls.find(call => call.pluginId === 'Filesystem' && call.methodName === 'writeFile');
  const share = calls.find(call => call.pluginId === 'Share' && call.methodName === 'share');
  expect(write?.options.directory).toBe('CACHE');
  expect(write?.options.recursive).toBe(true);
  expect(String(write?.options.path)).toMatch(/^exports\/\d+-Android paperwork\.pdf$/);
  const pdf = await PDFDocument.load(Buffer.from(String(write?.options.data), 'base64'));
  expect(pdf.getPageCount()).toBe(2);
  expect(share?.options.files).toEqual([`file:///data/user/0/app.scanandorganize.documents/cache/${write?.options.path}`]);
  expect(downloads).toEqual([]);
});

test('native camera denial is actionable, photo selection works, cache failure never downloads', async ({ page }) => {
  await installAndroidBridge(page, { denied: true });
  await page.goto('/'); await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await expect(page.locator('.camera-placeholder')).toContainText('Camera access is turned off');
  const calls = await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls);
  expect(calls.some(call => call.pluginId === 'CameraAccess' && call.methodName === 'request')).toBe(true);
  await importPage(page);
  await page.getByLabel('Document name', { exact: true }).fill('Keep this scan');
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await page.getByRole('button', { name: 'Open document Keep this scan', exact: true }).click();
  await page.evaluate(() => { (window as unknown as NativeWindow).__nativeFailWrite = true; });
  const downloads: string[] = []; page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('cache is full');
  expect(downloads).toEqual([]);
  await expect(page.getByRole('img', { name: 'Page 1 of Keep this scan', exact: true })).toBeVisible();
});

test('missing native Share plugin reports a rebuild requirement instead of a WebView download', async ({ page }) => {
  await installAndroidBridge(page, { missingShare: true });
  await page.goto('/'); await saveOnePage(page);
  await page.getByRole('button', { name: 'Open document Offline receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('Native PDF sharing is unavailable');
});

test('Android background stops the camera and the native back button preserves unsaved pages', async ({ page }) => {
  await installAndroidBridge(page);
  await page.goto('/'); await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as NativeWindow).__fireNativeEvent('appStateChange', { isActive: false }));
  await expect(page.getByRole('heading', { name: 'Camera paused', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
  await importPage(page);
  await page.evaluate(() => (window as unknown as NativeWindow).__fireNativeEvent('backButton', {}));
  await expect(page.getByRole('dialog', { name: 'Discard this scan?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save document', exact: true })).toBeEnabled();
});
