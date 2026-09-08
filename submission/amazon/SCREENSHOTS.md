# Required Fire-tablet screenshots

**No device screenshots are supplied in this pack.** The workspace has no Fire device or uploaded APK to capture. Do not replace this gap with invented native save dialogs, stock device mockups or images that misrepresent the submitted build.

Amazon requires **3–10** tablet screenshots in PNG or JPEG, in portrait or landscape. Its documented sizes are 800×480, 1024×600, 1280×720, 1280×800, 1920×1080, 1920×1200 and 2560×1600, including portrait rotations. Check the current console if your device's native size differs; do not stretch the UI to fit. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

## Suggested sequence

1. **Library:** a few clearly named demo scans in Receipts, Personal and Work, with real thumbnails and folder counts.
2. **Manual crop:** a sample page with the four corner handles visible; no camera permission dialog over it.
3. **Multi-page review:** two or three pages, reorder handles, a meaningful sample document name and folder selector.
4. **Document viewer:** a readable sample page with the Export as PDF button visible.
5. **Folder/search view:** show name search or a populated folder, if it adds useful information.

Three strong images are better than many redundant ones. Use the exact final build and stock Fire software. Capture a native PDF picker only if it is genuinely displayed on that tested device; the web-preview fallback is not an acceptable substitute for a native-picker screenshot.

## Protect personal information

Use synthetic receipts, letters or notes you create for this purpose. Do not show real identity cards, addresses, account numbers, payment details, medical records, customer paperwork or support messages. Avoid misleading price/rating/buy-button overlays. The packaged app still starts empty: demo data must stay on the test device, not be seeded into the release.

Amazon's guidance specifically requires dummy information when a screenshot would otherwise contain personal information. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

## Capture locally

On a supported Fire tablet, use its screenshot controls or ADB. Amazon provides device-specific screenshot instructions. [6](https://developer.amazon.com/docs/app-submission/taking-screenshots.html)

A cross-platform ADB workflow (use your own unique filenames):

```sh
adb shell screencap -p /sdcard/Download/scan-organize-01.png
adb pull /sdcard/Download/scan-organize-01.png submission/amazon/screenshots/01-library.png
```

This creates a screenshot on the tablet; it does not install or modify the APK. Check what is visible before capturing, including notifications and system bars. Do not include unrelated apps or screens.

Repeat for the crop, review and viewer screens. Record each file in `submission.json`:

```json
{
  "file": "screenshots/01-library.png",
  "origin": "fire-device",
  "deviceModel": "ACTUAL MODEL / GENERATION",
  "reviewed": false,
  "sha256": "ACTUAL FILE SHA-256"
}
```

Compute a hash with `sha256sum <file>` on Linux, `shasum -a 256 <file>` on macOS, or `Get-FileHash <file> -Algorithm SHA256` in PowerShell. Set reviewed to true only after checking dimensions, readability, dummy-data safety and agreement with the final APK. The submission checker rejects missing/unreviewed screenshots instead of marking the pack ready.
