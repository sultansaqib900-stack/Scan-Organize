# Scan & Organize

An offline-first scanner and organizer for the **Amazon Appstore on Fire tablets**: Next.js static export + a thin Capacitor Fire OS/Android shell. Our code has no backend, API routes, runtime SSR, accounts, payments, analytics, remote fonts, or external runtime requests. See the [Amazon release guide](docs/AMAZON-APPSTORE.md), including the important store-added-code caveat.

## Run locally

Requires **Node.js 22+**.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. Camera access needs localhost or HTTPS; a phone visiting a plain HTTP LAN address cannot use `getUserMedia`. The scanner also offers **Choose a photo** when a camera is unavailable or denied.

To test the actual offline-capable static output, stop the dev server first:

```sh
npm run build       # produces out/ and its versioned offline cache
npm run preview     # serves only out/ at http://localhost:3000
```

Do not use `next start` or open `out/index.html` via `file://`. The preview server is a test file server, **not part of the APK**. The npm scripts also disable Next's build/development telemetry.

### Offline behavior

- **Fire tablet first launch:** all assets are packaged in the APK. Capacitor intercepts its internal `https://localhost` URLs locally; there is no listening HTTP server or internet dependency. The manifest removes INTERNET permission and disables app-data cloud backup/device transfer.
- **Browser:** a new browser must first receive the static files (a local server works without internet). Once **Works offline** appears, all assets—including PDF code and fonts—are cached for offline reloads. A never-visited remote website cannot load offline.
- Service workers are disabled in development and in Capacitor. Browser cache updates wait until all app tabs close; reopen after a new static build. APK upgrades never depend on this cache.

## Amazon paid-download submission

Start with [`submission/amazon/START-HERE.md`](submission/amazon/START-HERE.md). It includes plain-text listing copy, 114/512px icons, promotional artwork, privacy-label guidance and a checklist for the one-time paid listing. No IAP or payment SDK is required by this implementation.

**Before a release build**, fill and approve `config/publisher.json` after reviewing `config/privacy-policy.json`. The app now has an offline **Privacy & support** view. `npm run amazon:release` validates those details before building/syncing; the native release task rejects missing/draft/stale privacy assets. Debug/browser previews may show a clearly marked draft. Host the generated `public/privacy.html` at your approved public HTTPS policy URL. Rebuild any APK made before this update.

```sh
npm run amazon:release
npm run amazon:assets
npm run amazon:apk-check -- /path/to/signed-release.apk
npm run amazon:submission-check
```

The APK checker requires local Android SDK tools; it does not upload or execute your APK. No actual APK/signature, Fire hardware, Amazon-processed artifact, or public policy URL has been verified here. Price, publisher identity, support contact, policy approval and screenshots are intentionally not invented. See the submission pack for the remaining gates.

## Build the Amazon Fire tablet APK

The `android/` project is included. Install Android Studio, **JDK 21**, and **Android SDK 36**. Release target: **Fire OS 7/8 (API 28+) with Amazon System WebView based on Chromium 111+**. Fire OS alone does not establish WebView compatibility. Fire TV/Stick, Kindle e-readers and Fire OS 5/6 are not supported by this build. Tooling installation may need internet; the installed app does not.

```sh
npm run amazon:check  # source guardrails, not APK certification
npm run amazon:sync   # rebuilds out/ and copies assets/plugins into android/
npm run amazon:open   # opens Android Studio
```

Build an APK in Android Studio, or:

```sh
cd android
./gradlew assembleDebug       # Windows: gradlew.bat assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Upload a signed release **APK**, not the debug/unsigned artifact. Use APK signature v2 or higher and keep signing keys outside Git. Set the one-time price in Amazon's console; no billing/DRM SDK is added. Follow the [Amazon submission and device-validation steps](docs/AMAZON-APPSTORE.md).

**Run `npm run amazon:sync` after every web/config change.** (`android:sync` remains an alias-compatible workflow.) Do not add a live-reload `server.url` to a release. Keep the app ID and local origin unchanged after shipping: they identify the saved library.

When using another shell, retain `CameraAccessPlugin.java`, `PdfSavePlugin.java`, both registrations, the manifest filters/queries, and Filesystem/Share/App plugins. The supplied shell also configures native PDF file access, back navigation and safe-area handling. See [Android validation](docs/ANDROID-TESTING.md).

## Screens and structure

| Area | Files |
| --- | --- |
| Library, folders, global name search | `components/workspace.tsx`, `library.tsx`, `sidebar.tsx` |
| Camera → corner adjustment → page review/reorder | `components/scan-flow.tsx` and its three screen components |
| Swipeable viewer, rename/delete, PDF export | `components/document-viewer.tsx` |
| IndexedDB transactions and folder metadata | `lib/storage.ts`, `lib/model.ts` |
| Perspective warp, contrast/sharpening, adaptive B&W | `lib/image-processing.ts` |
| jsPDF and native save/share/cache bridge | `lib/pdf.ts`, `lib/native-pdf.ts`, `lib/native.ts`, `android/` |
| Bundled assets/font and offline cache | `public/`, `app/globals.css`, `scripts/build-offline.mjs` |

The four initial folders are **empty**; tests never seed app data. Folder names use localStorage. Documents, thumbnails and JPEG page Blobs use IndexedDB; a document and its pages save/delete atomically. Deleting a folder moves its documents to the default folder, which can be renamed but not deleted.

## Permissions and PDF export

Camera permission is requested only while scanning. Streams stop after capture, when leaving, and in the background. Denied/busy/missing-camera messages offer retry or photo selection. Storage denial/quota errors are visible, and failed saves retain the draft.

PDF export creates one A4 page per scan, preserving orientation. It writes the private cached PDF in **256 KiB chunks** to limit bridge memory, then tries the **native local file-save picker**. The native copy streams with a 64 KiB buffer. If no system picker is available, it uses **Capacitor Share**. A cancellation or write failure does not trigger another destination. No Google Drive/viewer app, broad storage permission, or browser download is required for the native-save path. Picker/provider availability must still be tested on each Fire firmware/profile.

Browser testing prefers supported file sharing, otherwise uses a clearly labeled download fallback. Native share destinations depend on installed apps; the local save path uses the system file provider. Choosing another app explicitly gives it the exported PDF; its network/privacy behavior is outside this app.

## Tests and known limits

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e      # includes Fire-sized touch/bridge contracts
npm run test:fire     # Fire profiles only
```

Verified here: **51 unit tests and 37 browser/native-bridge contract tests**, static export, TypeScript, ESLint, accessibility, offline reload/PDF, camera lifecycle, touch crop/reorder/swipe, storage failure/retry and real PDF contents. The full end-to-end suite passed on Chromium 111, including Fire HD 8/10-sized profiles. Dependency audit reported no vulnerabilities.

**Real Fire/Android compilation and device testing was not possible here** (no JDK, SDK, emulator or device). The tests use the real Capacitor JavaScript bridge in Chromium with simulated OS responses, not Amazon System WebView or a real file picker. Run the included [native instrumentation tests](docs/ANDROID-TESTING.md) and the [stock-Fire/Amazon-processed-APK release gate](docs/AMAZON-APPSTORE.md) before shipping. Amazon documents store-added Appstore communication/analytics even with DRM disabled; our analytics-free source is not a guarantee about its processed APK. [5](https://developer.amazon.com/docs/app-submission/understanding-submission.html)

Deliberate v1 limitations:

- Manual crop; no OCR, automatic edge detection, cloud sync or post-save page editing. Draft pages can be retaken, removed and reordered with touch or keyboard.
- **40 pages/document**, **2,200-pixel longest edge**, **30 MB/photo input** to bound memory. Large documents may be slower on low-memory devices. JPEG/PNG/WebP are reliable; HEIC decoding is device-dependent.
- Drafts remain in memory until Save. Closing prompts before discarding, but an OS process kill can lose an unsaved draft. Wait for the saved confirmation before leaving.
- Clearing app/site data, uninstalling, browser eviction or device loss can remove saved scans. Export important documents. Browser storage persistence is best-effort and its optional persistence API is guarded.
- Data relies on the Android sandbox/device protection, not extra in-app encryption. PDFs are unencrypted. Private export-cache files remain available to recipients until Android clears them.
