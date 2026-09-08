import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { installAndroidBridge, saveOnePage, serveBundledAssetsWithoutNetwork } from './helpers';

interface NativeCall { pluginId: string; methodName: string; options: Record<string, unknown> }
interface NativeWindow { __nativeCalls: NativeCall[] }

// These are Fire-sized touch/bridge contracts in Chromium, not real Fire OS.
test('bundled offline Fire tablet flow saves a real PDF without a share app', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'saved', missingShare: true });
  await serveBundledAssetsWithoutNetwork(page);
  await page.goto('/');
  await saveOnePage(page, 'Fire tablet receipt');
  await page.getByRole('button', { name: 'Open document Fire tablet receipt', exact: true }).click();
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('PDF saved to the location you chose');
  const calls = await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls);
  const writes = calls.filter(call => call.pluginId === 'Filesystem' && ['writeFile', 'appendFile'].includes(call.methodName));
  const bytes = Buffer.concat(writes.map(call => Buffer.from(String(call.options.data), 'base64')));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  const save = calls.find(call => call.pluginId === 'PdfSave' && call.methodName === 'save');
  expect(save?.options.fileName).toBe('Fire tablet receipt.pdf');
  expect(save?.options.sourceUri).toBe(`file:///data/user/0/app.scanandorganize.documents/cache/${writes[0].options.path}`);
  expect(calls.some(call => call.pluginId === 'Share')).toBe(false); expect(downloads).toEqual([]);
});

test('cancelling the Fire native picker does not trigger sharing or a download', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'cancelled' });
  await page.goto('/'); await saveOnePage(page);
  await page.getByRole('button', { name: 'Open document Offline receipt', exact: true }).click();
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls.some(call => call.pluginId === 'PdfSave'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Export as PDF', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls.some(call => call.pluginId === 'Share'))).toBe(false);
  await expect(page.locator('.error-message')).toHaveCount(0); expect(downloads).toEqual([]);
});

test('a Fire build without a system file picker falls back to native PDF sharing', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'unavailable' });
  await page.goto('/'); await saveOnePage(page);
  await page.getByRole('button', { name: 'Open document Offline receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('native share sheet');
  const calls = await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls);
  expect(calls.findIndex(call => call.pluginId === 'PdfSave')).toBeLessThan(calls.findIndex(call => call.pluginId === 'Share'));
});

test('file/profile restrictions are reported without losing the saved Fire document', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'error' });
  await page.goto('/'); await saveOnePage(page);
  await page.getByRole('button', { name: 'Open document Offline receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('restricted by this profile');
  await expect(page.getByRole('img', { name: 'Page 1 of Offline receipt', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as NativeWindow).__nativeCalls.some(call => call.pluginId === 'Share'))).toBe(false);
});

test('Fire tablet portrait/landscape layout and safe areas keep controls reachable', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'saved' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Receipts, 0 documents', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
  });
  const viewport = page.viewportSize(); if (!viewport) throw new Error('No viewport');
  for (const size of [viewport, { width: viewport.height, height: viewport.width }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Scan document', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scan a document' })).toHaveCount(0);
  }
});
