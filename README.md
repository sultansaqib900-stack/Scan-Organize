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
| Verified vault, custody receipts | `components/verified-vault.tsx`, `lib/ledger.ts`, `lib/receipt.ts`, `lib/digest.ts` |
| Camera → corner adjustment → page review/reorder | `components/scan-flow.tsx` and its three screen components |
| Swipeable viewer, rename/delete, PDF export | `components/document-viewer.tsx` |
| IndexedDB transactions, folder metadata, schema upgrades | `lib/storage.ts`, `lib/model.ts` |
| Perspective warp, contrast/sharpening, adaptive B&W | `lib/image-processing.ts` |
| jsPDF and native save/share/cache bridge | `lib/pdf.ts`, `lib/native-pdf.ts`, `lib/native.ts`, `android/` |
| Bundled assets/font and offline cache | `public/`, `app/globals.css`, `scripts/build-offline.mjs` |

### Verified vault and custody receipts

Every save, rename and delete appends a hash-chained entry to an append-only ledger in IndexedDB, and every page stores a SHA-256 of its own bytes. **Verify vault** (footer, or the sidebar's on-device status) re-links the whole chain and re-reads documents to answer one question honestly: *is what I saved still what is here?*

- Silent corruption (bad flash, an interrupted write, cleared data) is named per document and per page, not discovered later when a document is opened.
- A start-to-finish check with no issues becomes the trusted point for that device; later checks prove nothing was changed since then.
- Documents saved by an earlier version have no ledger entry. The check says so plainly and offers to record a **baseline** — it never claims to have verified history it did not see.
- Large libraries are checked inside a **96 MB re-read budget**; the remaining pages are still compared against their recorded digests and the result is labelled *partial*. **Deep check** re-reads every byte.
- A **custody receipt** is two files: a PDF for people and a `.json` check file. Anyone can open the check file in the app's *Check a receipt* screen — offline, on any device — and the app recomputes every digest and re-links the chain without access to the tablet that issued it.

What it does **not** do: it is not a signature and not a legal certification, and it cannot detect an attacker who rewrites both the documents and the ledger. Keeping a receipt somewhere other than the tablet is what closes that gap — comparing an older receipt with a newer one is what makes a rewound ledger visible. Nothing is ever repaired or deleted automatically.

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

Verified in the build before this feature: **51 unit tests and 37 browser/native-bridge contract tests**, static export, TypeScript, ESLint, accessibility, offline reload/PDF, camera lifecycle, touch crop/reorder/swipe, storage failure/retry and real PDF contents. The verified-vault work adds **74 unit tests** (23 of them for the ledger, receipts and the v1→v2 upgrade) and a five-case browser spec in `tests/e2e/vault.spec.ts`; those browser cases could not be executed in the environment where the feature was built (no Playwright browser download), so run `npm run test:e2e` before release. The full end-to-end suite passed on Chromium 111, including Fire HD 8/10-sized profiles. Dependency audit reported no vulnerabilities.

**Real Fire/Android compilation and device testing was not possible here** (no JDK, SDK, emulator or device). The tests use the real Capacitor JavaScript bridge in Chromium with simulated OS responses, not Amazon System WebView or a real file picker. Run the included [native instrumentation tests](docs/ANDROID-TESTING.md) and the [stock-Fire/Amazon-processed-APK release gate](docs/AMAZON-APPSTORE.md) before shipping. Amazon documents store-added Appstore communication/analytics even with DRM disabled; our analytics-free source is not a guarantee about its processed APK. [5](https://developer.amazon.com/docs/app-submission/understanding-submission.html)

Deliberate v1 limitations:

- Manual crop; no OCR, automatic edge detection, cloud sync or post-save page editing. Draft pages can be retaken, removed and reordered with touch or keyboard.
- **40 pages/document**, **2,200-pixel longest edge**, **30 MB/photo input** to bound memory. Large documents may be slower on low-memory devices. JPEG/PNG/WebP are reliable; HEIC decoding is device-dependent.
- Drafts remain in memory until Save. Closing prompts before discarding, but an OS process kill can lose an unsaved draft. Wait for the saved confirmation before leaving.
- Clearing app/site data, uninstalling, browser eviction or device loss can remove saved scans. Export important documents. Browser storage persistence is best-effort and its optional persistence API is guarded.
- Data relies on the Android sandbox/device protection, not extra in-app encryption. PDFs are unencrypted. Private export-cache files remain available to recipients until Android clears them.
- Integrity verification proves *consistency with what the app recorded*, not authorship or legal authenticity. It is not a signature, has no external trust anchor, and cannot detect a rewrite of both the documents and the ledger. It also cannot detect changes made before a document was first covered by the ledger.
- The ledger grows by one entry per save/rename/delete (bounded: a few hundred bytes each, no page bytes). Folders are metadata and are not covered by the chain.
