import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    permissions: ['camera'],
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, testIgnore: ['**/webview.spec.ts', '**/fireos.spec.ts'] },
    { name: 'android-webview-contract', use: { ...devices['Pixel 7'], deviceScaleFactor: 1 }, testMatch: '**/webview.spec.ts' },
    // Representative Fire tablet CSS dimensions and embedded-WebView UAs.
    // These do not emulate Amazon's actual OS, provider, or WebView build.
    {
      name: 'fire-hd-8',
      use: { viewport: { width: 600, height: 960 }, deviceScaleFactor: 4 / 3, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 11; KFRAPWI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.207 Safari/537.36' },
      testMatch: ['**/webview.spec.ts', '**/fireos.spec.ts'],
    },
    {
      name: 'fire-hd-10',
      use: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 11; Fire tablet; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.207 Safari/537.36' },
      testMatch: ['**/webview.spec.ts', '**/fireos.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
