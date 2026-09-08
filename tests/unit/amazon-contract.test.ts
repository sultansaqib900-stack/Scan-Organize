import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkAmazonSources } from '../../scripts/check-amazon.mjs';
import config from '../../capacitor.config';

describe('Amazon release source guardrails (not APK certification)', () => {
  it('keeps compatible tablet filters, legacy icons, local APIs and no Google/billing dependencies', async () => {
    expect(await checkAmazonSources()).toEqual([]);
  });
  it('ships offline assets under the same local origin and disables HTTP/cookie interception', () => {
    expect(config.webDir).toBe('out'); expect(config.server?.url).toBeUndefined();
    expect(config.server?.hostname).toBe('localhost'); expect(config.server?.androidScheme).toBe('https');
    expect(config.android?.minWebViewVersion).toBe(111);
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(false); expect(config.plugins?.CapacitorCookies?.enabled).toBe(false);
  });
  it('provides an offline Fire OS update message, not a Google Play installation instruction', async () => {
    const page = await readFile('public/webview-update.html', 'utf8');
    expect(page).toContain('Amazon System WebView'); expect(page).toContain('Device Options → System Updates');
    expect(page).toContain('cannot run on it'); expect(page).not.toContain('<script'); expect(page).not.toContain('href="https://');
  });
});
