import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.scanandorganize.documents',
  appName: 'Scan & Organize',
  webDir: 'out',
  // No server.url: every asset is copied into the APK by cap sync.
  server: {
    hostname: 'localhost',
    androidScheme: 'https', // A local secure origin is necessary for getUserMedia.
    allowNavigation: [],
    errorPath: 'webview-update.html',
  },
  plugins: {
    SystemBars: { style: 'LIGHT', insetsHandling: 'css', hidden: false },
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#f8f9f5',
    // Capacitor 8 detects the active provider, including Amazon System WebView.
    // Keep Next.js 16's real engine floor; do not silently admit older engines.
    minWebViewVersion: 111,
    loggingBehavior: 'none',
  },
};

export default config;
