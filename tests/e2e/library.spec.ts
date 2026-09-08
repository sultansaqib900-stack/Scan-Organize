import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { fixtureA, fixtureB, importPage, saveOnePage } from './helpers';

test('an empty private library, folder creation, rename, duplicate validation and deletion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Receipts, 0 documents' })).toBeVisible();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Taxes');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Taxes', exact: true }).click();
  await page.getByRole('button', { name: 'Rename folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Receipts');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('already exists');
  await page.getByLabel('Folder name', { exact: true }).fill('Tax records');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Tax records, 0 documents' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Actions for Tax records', exact: true }).click();
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('nothing will be lost');
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Tax records, 0 documents' })).toHaveCount(0);
});

test('camera capture, corner movement, retake and stream cleanup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const streams: MediaStream[] = [];
    Object.assign(window, { __streams: streams });
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); streams.push(stream); return stream; };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Capture page', exact: true }).click();
  const corner = page.getByRole('button', { name: 'Top left crop corner', exact: true });
  await expect(corner).toBeVisible();
  const before = await corner.getAttribute('style');
  await corner.focus(); await page.keyboard.press('ArrowRight');
  expect(await corner.getAttribute('style')).not.toBe(before);
  const rect = await corner.boundingBox();
  if (!rect) throw new Error('Corner not rendered');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 25, rect.y + rect.height / 2 + 20, { steps: 6 }); await page.mouse.up();
  expect(await corner.getAttribute('style')).not.toBe(before);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.getByRole('button', { name: 'Retake photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('multi-page crop, filters, reordering, page deletion, save, rename, search and real PDF export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await importPage(page, fixtureA, true);
  await page.getByLabel('Document name', { exact: true }).fill('Warranty');
  await page.getByLabel('Save in folder').selectOption('receipts');
  await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard this scan?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add a page', exact: true }).click();
  await importPage(page, fixtureB);
  await expect(page.getByLabel('Document name', { exact: true })).toHaveValue('Warranty');
  await expect(page.getByLabel('Save in folder')).toHaveValue('receipts');
  const originalOrder = await page.locator('.draft-thumbnail').evaluateAll(elements => elements.map(el => el.getAttribute('data-page-id')));
  await page.getByRole('button', { name: 'Reorder page 1', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Reorder page 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status').filter({ hasText: 'Moving page 1 to position 2.' })).toBeAttached();
  await page.keyboard.press('Space');
  await expect.poll(() => page.locator('.draft-thumbnail').evaluateAll(elements => elements.map(el => el.getAttribute('data-page-id')))).toEqual([...originalOrder].reverse());
  await page.getByRole('button', { name: 'Add a page', exact: true }).click();
  await importPage(page);
  await page.getByRole('button', { name: 'Delete page 3', exact: true }).click();
  await expect(page.locator('.draft-thumbnail')).toHaveCount(2);
  await page.getByRole('button', { name: 'Retake page', exact: true }).click();
  await importPage(page, fixtureA);
  await expect(page.locator('.draft-thumbnail')).toHaveCount(2);
  await expect(page.getByLabel('Document name', { exact: true })).toHaveValue('Warranty');
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await page.getByRole('button', { name: 'Open document Warranty', exact: true }).click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.viewer-footer')).toContainText('Page 2 of 2');
  await page.getByRole('button', { name: 'Rename document', exact: true }).click();
  await page.getByLabel('Document name', { exact: true }).fill('Home warranty');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home warranty', exact: true, level: 1 })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Home warranty.pdf');
  const file = await download.path();
  if (!file) throw new Error('PDF did not download');
  expect((await PDFDocument.load(await readFile(file))).getPageCount()).toBe(2);
  await expect(page.getByRole('status')).toContainText('browser preview');
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Receipts, 1 document', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('HOME War');
  await expect(page.getByRole('button', { name: 'Open document Home warranty', exact: true })).toBeVisible();
  await expect(page.locator('.search-summary')).toContainText('across all folders');
  await page.getByRole('searchbox').fill('Does not exist');
  await expect(page.getByRole('heading', { name: 'No documents found' })).toBeVisible();
  await page.getByRole('searchbox').fill('Home');
  await page.getByRole('button', { name: 'Open document Home warranty', exact: true }).click();
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this document?' }).getByRole('button', { name: 'Delete document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this document?' })).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await expect(page.getByRole('button', { name: 'Open Receipts, 0 documents', exact: true })).toBeVisible();
});

test('deleting a populated folder preserves its documents in the default folder', async ({ page }) => {
  await page.goto('/'); await saveOnePage(page, 'Keep me', 'work');
  await page.reload();
  await page.getByRole('button', { name: 'Actions for Work', exact: true }).click();
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Unfiled, 1 document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Unfiled, 1 document', exact: true }).click();
  await page.getByRole('button', { name: 'Open document Keep me', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Page 1 of Keep me' })).toBeVisible();
});

test('camera denial is explained and choosing a photo remains available', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/'); await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await expect(page.locator('.camera-placeholder')).toContainText('Camera access is turned off');
  await expect(page.getByRole('button', { name: 'Capture page', exact: true })).toBeDisabled();
  await importPage(page);
  await expect(page.getByRole('button', { name: 'Save document', exact: true })).toBeEnabled();
});

test('denied persistent storage is not silently replaced with volatile memory', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage denied', 'SecurityError'); }; });
  await page.goto('/');
  await expect(page.locator('.error-message')).toContainText('On-device storage is unavailable');
  await expect(page.getByRole('button', { name: 'Scan document', exact: true })).toBeDisabled();
});

test('offline browser reload retains scans and lazy PDF code is precached', async ({ page, context }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:3000') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto('/'); await saveOnePage(page);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('button', { name: 'Open document Offline receipt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open document Offline receipt', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Offline receipt.pdf');
  expect(external).toEqual([]);
});

test('responsive library has no overflow and passes accessibility checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Receipts, 0 documents' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Scan document', exact: true })).toBeVisible();
  }
});


test('a storage quota failure keeps the draft and allows a successful retry', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    const flags = { full: true };
    Object.assign(window, { __quotaTest: flags });
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (flags.full && mode === 'readwrite') throw new DOMException('Device full', 'QuotaExceededError');
      return original.call(this, names, mode, options);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await importPage(page);
  await page.getByLabel('Document name', { exact: true }).fill('Still here');
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('low on storage');
  await expect(page.locator('.draft-thumbnail')).toHaveCount(1);
  await expect(page.getByLabel('Document name', { exact: true })).toHaveValue('Still here');
  await page.evaluate(() => { (window as unknown as { __quotaTest: { full: boolean } }).__quotaTest.full = false; });
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open document Still here', exact: true })).toBeVisible();
});
