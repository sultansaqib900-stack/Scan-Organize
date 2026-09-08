import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scan & Organize — A little less paper',
  description: 'Your private, offline document scanner. Scan, organize, and export your paperwork, entirely on your device.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Scan & Organize' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f8f9f5',
};

// All scripts, fonts and styles are bundled. Inline scripts are Next's static
// hydration payload; there is no third-party code, remote font, or remote image.
const productionCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head>{process.env.NODE_ENV === 'production' && <meta httpEquiv="Content-Security-Policy" content={productionCsp} />}</head><body>{children}<noscript><div className="noscript-message">Scan & Organize needs JavaScript to access your camera and on-device library. Please enable JavaScript in your browser or use the Android app.</div></noscript></body></html>;
}
