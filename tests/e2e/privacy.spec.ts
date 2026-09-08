import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installAndroidBridge, serveBundledAssetsWithoutNetwork } from './helpers';
import publisher from '../../config/publisher.json';
import { publisherIssues } from '../../lib/publisher.mjs';

const draftPolicy = publisherIssues(publisher).length > 0;

test('privacy information opens offline, is accessible, and closes with native Back', async ({ page }) => {
  await installAndroidBridge(page, { nativeSave: 'saved' });
  await serveBundledAssetsWithoutNetwork(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Privacy & support', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Privacy & support', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Privacy & support', exact: true })).toBeVisible();
  if (draftPolicy) await expect(dialog).toContainText('Draft — not ready for submission');
  else await expect(dialog.locator('.privacy-draft')).toHaveCount(0);
  await expect(dialog).toContainText('Amazon handles payment before download');
  await expect(dialog).toContainText('does not add its own document encryption');
  const audit = await new AxeBuilder({ page }).include('.privacy-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => (window as unknown as { __fireNativeEvent: (name: string, data: object) => void }).__fireNativeEvent('backButton', {}));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Privacy & support', exact: true })).toBeFocused();
});

test('public policy is plain local HTML, with no scripts or tracking requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin !== 'http://127.0.0.1:3000') external.push(request.url()); });
  await page.goto('/privacy.html');
  await expect(page.getByRole('heading', { name: 'Scan & Organize', exact: true })).toBeVisible();
  if (draftPolicy) await expect(page.locator('aside')).toContainText('Draft — do not publish');
  else await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(0);
  expect(external).toEqual([]);
});
