# Fire OS / Android WebView validation

The publication target is Amazon Fire tablets. Start with [AMAZON-APPSTORE.md](AMAZON-APPSTORE.md) for OS/WebView limits, device filtering, signing and the store-wrapper caveat.

## Validation status

| Check | Status in this environment |
| --- | --- |
| Next.js production static export; no server routes | Passed |
| TypeScript, ESLint, npm dependency audit | Passed |
| Storage transactions, crop geometry/filter pixels, actual PDF parsing | 40 unit tests passed |
| Desktop browser workflows, offline reload/export, camera cleanup, accessibility | Passed |
| Fire HD 8/10-sized and Android touch profiles + the **actual Capacitor 8 native-bridge.js**, simulated OS responses | Passed; included in 31 end-to-end tests |
| Chromium 111 renderer floor (full end-to-end suite) | Passed; not an Amazon OS/WebView image |
| Real Fire/Android Java/Gradle compilation, Amazon/OEM WebView, camera hardware, native Filesystem/FileProvider/PdfSave/Share | **Not executed here** — no JDK/SDK/emulator/device |

The contract harness (`tests/e2e/helpers.ts`) can fulfill every asset from `out/` while transport is offline, with no service worker. It verifies the bundled-first-load design, plugin registration and message serialization; it is **not an Android emulator**. It checks denied permission, native save/cancel/unavailable/profile-error responses, native cache failure, a missing Share plugin, native back/background events, touch dragging/swiping, and the full base64 multi-page PDF handed to the native share transport. No browser download is allowed on the native path.

## Automated tests on a real WebView

On your local machine, install JDK 21, Android SDK 36, and a USB-debuggable, compatible **stock Fire tablet**. A camera-enabled Android emulator is useful as a secondary check but cannot certify Fire OS behavior. Then:

```sh
npm ci
npm run amazon:sync
cd android
./gradlew connectedDebugAndroidTest
# Windows: gradlew.bat connectedDebugAndroidTest
```

`OfflineWebViewTest.java` runs **inside Android**, and checks:

1. The bundled UI opens at secure `https://localhost` without INTERNET permission, and all required plugins are registered.
2. Real WebView IndexedDB Blob and localStorage round trips (using isolated test keys/databases, not your documents).
3. Native CAMERA permission, `getUserMedia`, a nonempty canvas JPEG and stopped camera tracks. The test runner explicitly grants permission; use a device/emulator with a working camera.
4. Real Capacitor Filesystem cache write/read and a FileProvider content URI that can read the exported test file without shared-storage permission.
5. Registration of `PdfSave`, and rejection of files outside the private export-cache directory without launching a picker.

These instrumentation tests do not automate selecting a real save destination or external share target. Those operations must be exercised on the actual Fire provider, including permissions and cancellation. They have not been compiled or run in this sandbox. Confirm the actual result locally; do not treat the passing Chromium tests as a substitute.

## Physical-device release checklist

Use a Fire OS 7 tablet and a Fire OS 8 tablet you intend to enable, with their current Amazon software and actual WebView versions recorded. Test both lower-memory/32-bit and newer/larger tablets where applicable. A normal Android phone/emulator is secondary, not a Fire substitute. Repeat critical checks using the Amazon-processed APK.

- [ ] Install a fresh debug/release APK. **Enable airplane mode before first launch.** The app opens with four empty folders, without a server, remote assets, account screen, or loading dependency.
- [ ] Deny camera permission; see actionable in-app text and a working photo picker. Deny permanently, re-enable permission in Android Settings, then retry. No microphone permission is requested.
- [ ] Grant camera access, capture a real page, drag each crop corner with a finger, retake, and compare Clean color vs Black & white. Verify perspective and text legibility.
- [ ] Add several portrait/landscape pages. Reorder with the handles, remove a page, name the document, choose a folder, and save. Confirm cover/order match after reopening and after force-stop/relaunch.
- [ ] Background the camera, return, and resume. Confirm the privacy camera indicator turns off while not scanning. Test rotation and switching apps while using the photo picker.
- [ ] Create/rename/delete folders. Deleting a populated folder moves documents to the default; it must not delete images. Search by name across folders. Rename/delete a document, cancel a deletion, and check folder counts after restart.
- [ ] View a multi-page document full-screen and swipe both directions, including after rotation. All controls remain usable with the keyboard open and with status/navigation bars/cutouts.
- [ ] Tap Export as PDF offline. The **native file-save picker** opens, or the native Share sheet if no system picker is available. Save to local internal storage and SD card where supported. Reopen the real PDF and verify page count, order, aspect ratio, readable content and filename. Also verify Share URI access after its sheet closes. No browser-download prompt is allowed.
- [ ] Cancel the save picker and verify no Share sheet follows. Also cancel sharing, retry, and test native cache/destination failure and profile restrictions (low-space/restricted test device). Errors must leave the saved document intact; a failed save must retain its draft.
- [ ] Android Back closes the top dialog/view. Back on an unsaved draft asks to discard. Back at the library minimizes the app instead of navigating to a nonexistent URL.
- [ ] Test a large document near the 40-page limit on the lowest-memory supported device. Ensure no black/empty canvas frames or PDF memory failures.
- [ ] Upgrade the APK **without uninstalling** and confirm saved data survives. Inspect the merged release manifest: CAMERA only, no INTERNET, shared-storage or microphone permissions; backup/device-transfer disabled.
- [ ] Verify release builds have no live-reload URL or web debugging override. Use your own release signing key. No payments or billing SDKs are included.

## API compatibility and native differences

| API | Requirement / handling |
| --- | --- |
| `navigator.mediaDevices.getUserMedia` | Secure origin and WebView video-capture support. The local HTTPS Capacitor origin and CAMERA manifest/plugin grant are required. Capacitor's `BridgeWebChromeClient` handles the origin's VIDEO_CAPTURE permission. Older/OEM WebViews may behave differently; errors offer photo selection. |
| `<input type="file">` | Capacitor's file chooser must be retained. Uses the system-selected content URI, not broad READ_MEDIA/READ_EXTERNAL_STORAGE permission. Missing picker apps or unsupported formats are device-dependent. No `capture` attribute bypasses the WebView camera flow. |
| Canvas 2D / `toBlob` / Blob URLs | Supported in modern Chromium WebView. No OffscreenCanvas, remote images or workers are required. Images are resized to limit allocations; very large imports remain subject to device memory. HEIC is not guaranteed. |
| Pointer Events, CSS scroll snap, HTML `dialog`, `ResizeObserver`, dynamic viewport units | Minimum engine is Chromium 111 (also exercised by the browser suite). Fire uses Amazon System WebView; follow official Amazon system updates, not Google Play. Native version checks show a local compatibility message on older engines. Fire OS version alone does not establish this requirement. |
| IndexedDB Blob storage + localStorage | Same local origin must be retained between releases. No OS storage permission required. Android WebView persistence is app-local; browser persistence/eviction differs. |
| `navigator.storage.persist()` | Optional best-effort browser hint; guarded and ignored if unsupported/denied. |
| Capacitor Filesystem (`Directory.Cache`) | App-private `exports/` directory; no external-storage permission. PDF bytes are passed in bounded 256 KiB base64-encoded chunks, not a whole-PDF bridge message or Blob URL. Partial private cache writes are cleaned up on failure. Native disk errors must be tested on-device. |
| Local `PdfSave` plugin / `ACTION_CREATE_DOCUMENT` | Requests a local PDF destination through the system provider. Streams the private cache source to the returned content URI with a 64 KiB buffer; no broad storage grant. Canonical-path validation prevents copying arbitrary app files. Provider presence, local/SD-card writing, profiles and cancellation require stock Fire tests. A failure may leave a partial destination file; the app does not delete an arbitrary user/provider-selected URI. |
| Capacitor Share / FileProvider | Shares local file URIs using a content URI and read grant. The provider exposes only `cache/exports/`. Keep cached exports until the recipient has read them. Available save/share destinations depend on installed Android apps. |
| `navigator.share` / `<a download>` | Browser preview only. **Never** used as a fallback on a native platform, even when plugins are absent. Browser file sharing may lose user activation during PDF generation, so the preview can download instead. |
| Service workers | Used only for the browser's production export. Skipped in Capacitor to prevent old cached JS surviving APK updates; all native assets are already bundled. |
| App background / Android Back / edge-to-edge | Capacitor App events stop capture and close the top dialog safely. Capacitor 8’s built-in SystemBars handles native insets and the keyboard; CSS uses its safe-area variables (with `env()` fallbacks). Validate with real navigation modes/OEM keyboards. |

Our source manifest removes network permissions. This is not a claim about Amazon’s post-upload wrapper or the separate Appstore client; see the Amazon release guide. Explicitly sharing a PDF to another application gives **that application** the file; its privacy/network behavior is outside Scan & Organize.
