import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { fixtureA, importPage } from './helpers';

async function saveDocument(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  await importPage(page, fixtureA);
  await page.getByLabel('Document name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('button', { name: `Open document ${name}`, exact: true })).toBeVisible();
}

async function openVault(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Verify vault', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Verify vault' })).toBeVisible();
  await expect(page.locator('.verify-status').first()).toContainText(/Verified|starting point/, { timeout: 20_000 });
}

test('the vault checks itself and reports a healthy chain after saving documents', async ({ page }) => {
  await page.goto('/');
  await saveDocument(page, 'Vault receipt');
  await page.getByRole('button', { name: 'Verify vault', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Verify vault' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.verify-status').first()).toContainText('Verified', { timeout: 20_000 });
  await expect(dialog).toContainText('1 document');
  await expect(dialog.locator('.verify-facts')).toContainText('complete');
  await expect(dialog.locator('.verify-issues')).toHaveCount(0);
  // No integrity problems must be announced as problems.
  await expect(dialog.locator('.error-message')).toHaveCount(0);
});

test('a changed page is named exactly, and nothing is repaired or deleted', async ({ page }) => {
  await page.goto('/');
  await saveDocument(page, 'Fragile receipt');
  // Replace one stored page's bytes behind the app's back, keeping its old digest.
  await page.evaluate(async () => {
    const open = indexedDB.open('scan-organize');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const pages = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const req = db.transaction('pages').objectStore('pages').getAll();
      req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put({ ...pages[0], image: new Blob(['not the original bytes'], { type: 'image/jpeg' }) });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Verify vault', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Verify vault' });
  await expect(dialog.locator('.verify-status').first()).toContainText('Issues found', { timeout: 20_000 });
  await expect(dialog.locator('.verify-issue').first()).toContainText('“Fragile receipt” page 1');
  await expect(dialog.locator('.verify-issue').first()).toContainText('no longer matches its recorded digest');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Still listed: verification never deletes or "repairs" evidence.
  await expect(page.getByRole('button', { name: 'Open document Fragile receipt', exact: true })).toBeVisible();
});

test('the receipt PDF and its machine-checkable JSON are real and agree with the vault', async ({ page }) => {
  await page.goto('/');
  await saveDocument(page, 'Receipt subject');
  await openVault(page);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Receipt PDF', exact: true }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/^Custody receipt \d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfPath = await pdf.path();
  if (!pdfPath) throw new Error('Receipt PDF did not download');
  const parsed = await PDFDocument.load(await readFile(pdfPath));
  expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(parsed.getTitle()).toContain('Custody receipt');
  expect(parsed.getCreator()).toBe('Scan & Organize');

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Check file', exact: true }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toMatch(/^Custody receipt \d{4}-\d{2}-\d{2}\.json$/);
  const jsonPath = await json.path();
  if (!jsonPath) throw new Error('Check file did not download');
  const receipt = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(receipt.format).toBe('scan-organize-custody-receipt');
  expect(receipt.version).toBe(1);
  expect(receipt.chain.entries).toHaveLength(1);
  expect(receipt.chain.entries[0].name).toBe('Receipt subject');
  expect(receipt.chain.entries[0].pages[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.chain.through.hash).toBe(receipt.chain.entries[0].hash);
  expect(receipt.integrity.self).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.verdict.ok).toBe(true);

  // Hand the device's own receipt back to it.
  await page.getByLabel('Choose a custody receipt file').setInputFiles(jsonPath);
  await expect(page.locator('.verify-receipt .verify-status')).toContainText('Receipt checks out');
  await expect(page.locator('.verify-receipt')).toContainText('1 document ·');
});

test('a receipt edited after issue is refused, and a foreign file is explained', async ({ page }) => {
  await page.goto('/');
  await saveDocument(page, 'Signed subject');
  await openVault(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Check file', exact: true }).click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error('Check file did not download');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  receipt.documents[0].name = 'Something else';

  await page.getByLabel('Choose a custody receipt file').setInputFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(receipt)) });
  await expect(page.locator('.verify-receipt .verify-status')).toContainText('Receipt does not check out');
  await expect(page.locator('.verify-receipt')).toContainText('changed after it was issued');

  await page.getByLabel('Choose a custody receipt file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ hello: 'world' })) });
  await expect(page.locator('.verify-receipt')).toContainText('not a Scan & Organize custody receipt');
});

test('documents saved by an earlier version are reported honestly, then covered by a baseline', async ({ page }) => {
  await page.goto('/');
  // Simulate a pre-ledger library: a document and page with no ledger entry.
  await page.evaluate(async () => {
    const open = indexedDB.open('scan-organize');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['documents', 'pages'], 'readwrite');
      tx.objectStore('documents').put({ id: 'old-doc', name: 'From last year', folderId: 'unfiled', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', pageIds: ['old-page'], thumbnail: new Blob(['t']) });
      tx.objectStore('pages').put({ id: 'old-page', documentId: 'old-doc', image: new Blob(['old bytes']), width: 600, height: 800 });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Verify vault', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Verify vault' });
  await expect(dialog.locator('.verify-issue').first()).toContainText('no ledger entry', { timeout: 20_000 });
  await expect(dialog.locator('.verify-baseline')).toContainText('1 document from before integrity tracking');
  await page.getByRole('button', { name: 'Record baseline', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Record an integrity baseline?' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Record an integrity baseline?' }).getByRole('button', { name: 'Record baseline', exact: true }).click();
  await expect(dialog.locator('.verify-status').first()).toContainText('Verified', { timeout: 20_000 });
  await expect(dialog.locator('.verify-issues')).toHaveCount(0);
});

test('the verify view is accessible and fits a Fire-sized touch screen', async ({ page }) => {
  await page.goto('/');
  await saveDocument(page, 'Accessible receipt');
  await page.getByRole('button', { name: 'Verify vault', exact: true }).click();
  await expect(page.locator('.verify-status').first()).toContainText('Verified', { timeout: 20_000 });
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  const audit = await new AxeBuilder({ page }).include('.verify-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Every control in the view is reachable and at least 24px tall.
  const small = await page.locator('.verify-dialog button:visible').evaluateAll(buttons => buttons
    .map(button => ({ label: button.textContent?.trim() || button.getAttribute('aria-label'), height: button.getBoundingClientRect().height }))
    .filter(item => item.height < 24));
  expect(small).toEqual([]);
});
