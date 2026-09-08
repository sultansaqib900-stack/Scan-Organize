# Amazon Appstore / Fire tablet release

## Intended devices

This release targets **touchscreen Fire tablets running Fire OS 7 or 8, with an Amazon System WebView based on Chromium 111 or newer**. This is a compatibility target, not a claim that every model/firmware has passed device testing. Fire OS 7 is based on Android 9/API 28, and Fire OS 8 on Android 11/API 30. [1](https://developer.amazon.com/docs/fire-tablets/fire-os-7.html) [3](https://developer.amazon.com/docs/fire-tablets/fire-os-8.html)

- `minSdkVersion = 28` deliberately excludes Fire OS 5/6. Keep `targetSdkVersion = 36` and `compileSdkVersion = 36`: a high **target** does not require that Android version on the device. The **minimum** controls eligibility. Amazon documents minimum targets and device filtering separately. [4](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html)
- A Fire OS version alone does **not** establish the installed WebView version. Capacitor checks the active provider; the Next.js renderer floor remains 111. Do not lower that check simply to hide an incompatibility. The fallback HTML explains official Fire system updates, never instructing the user to install Google Play/Chrome/WebView.
- **No Fire TV/Stick, Kindle e-reader, Echo, or non-Android/Vega build is supplied.** This app needs touch interaction and a camera. Do not enable those product families in the submission.
- A Kids-edition tablet in its normal adult profile can be a test candidate; support for a restricted child profile is not assumed. Validate camera, file-picker and sharing restrictions before advertising it.
- Keep the universal APK/no ABI filters. Fire tablet specifications include both 32-bit and 64-bit environments; some models have a 64-bit CPU but 32-bit app ABI. Fixed-focus cameras must remain supported. [1](https://developer.amazon.com/docs/device-specs/ft-device-specifications-firehd-models.html)

Useful physical validation candidates—not certified devices—are Fire HD 8 (2020 / Fire OS 7), Fire HD 8 (2022/2024 / Fire OS 8), Fire HD 10 (2021 / Fire OS 7 and 2023 / Fire OS 8), and Fire Max 11 (2023 / Fire OS 8). Check Amazon's current device specifications rather than inferring OS/ABI from the screen size. [1](https://developer.amazon.com/docs/device-specs/ft-device-specifications-firehd-models.html)

## What differs from a generic Android build

- No Google Play Services, Firebase, Google sign-in, Google billing, Google Drive, Amazon IAP/DRM, login or analytics SDK is integrated. Android Studio, AndroidX and the `google()` **build-time Maven repository** are not Google Play Services runtime dependencies.
- Manifest requires touchscreen and **any** camera, but does not require autofocus or a rear camera. Phone-sized, large and extra-large screen layouts remain enabled. There is no orientation lock or ARM64-only split.
- Raster launcher PNGs are retained at every density, with no adaptive-icon override. Amazon documents that Fire OS 7 does not support adaptive icons. [1](https://developer.amazon.com/docs/fire-tablets/fire-os-7.html) The PNG/mipmap density approach also follows the launcher guidance. [2](https://developer.amazon.com/docs/fire-tablets/ft-launcher-icon-guidelines.html)
- The local HTTPS origin and app ID stay unchanged; assets are copied into the APK and native service workers are skipped. Our source manifest removes INTERNET/ACCESS_NETWORK_STATE and disables automatic backup. Amazon's own Fire Auto Backup documentation describes opting out through the manifest. [3](https://developer.amazon.com/docs/fire-tablets/fire-os-8.html)
- Camera uses `getUserMedia` after the local `CameraAccess` permission bridge; autofocus is not requested. Permissions are rechecked when reopening/resuming capture.
- **Export as PDF** first tries the native `PdfSave` plugin: Android's Storage Access Framework `ACTION_CREATE_DOCUMENT`, PDF MIME type, `CATEGORY_OPENABLE`, and a local-only destination hint. Availability must be verified on the actual Fire firmware/profile.
- If the system picker is unavailable, export falls back to Capacitor's native Share sheet. Cancelling the picker does **not** launch sharing, and a write/profile failure is shown rather than silently changing destinations. There is never a native-WebView browser-download fallback.
- No Google Drive or third-party PDF viewer is needed when a local system save provider is available. If neither local saving nor sharing is usable on a stock model, do **not** mark that model supported until resolved. Android SEND support does not establish that an offline file-saving destination is installed. [2](https://developer.amazon.com/docs/fire-tablets/ft-supported-android-intents.html)
- PDFs cross the JS/native bridge in **256 KiB binary chunks**, and the native cache-to-destination copy streams with a **64 KiB buffer**. This avoids another full-PDF base64 allocation in the native heap. The JS PDF generation/page limits still apply; run large-document tests on lower-memory Fire tablets.

## Build and submission

Install Node 22+, JDK 21 and Android SDK 36 (Android Studio is the easiest setup).

```sh
npm ci
npm run amazon:check  # source guardrails only, not APK certification
npm run amazon:sync   # static export + Capacitor copy/sync
npm run amazon:open   # Android Studio
```

Build a debug APK for a test tablet:

```sh
cd android
./gradlew assembleDebug       # Windows: gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For the Amazon Appstore, use Android Studio **Generate Signed Bundle / APK → APK**, a release build, and your own release key. Do not upload the debug APK or the unsigned `assembleRelease` result. Enable APK signature scheme **v2 or higher** (including v1 + v2 is fine). Fire OS 8 does not accept a v1-only APK. [3](https://developer.amazon.com/docs/fire-tablets/fire-os-8.html)

Inspect the final APK with Android Studio's APK Analyzer and your SDK's `apksigner verify --verbose <signed.apk>`. Check the final merged manifest, signature, all local assets/fonts, plugin classes, raster icons and lack of Google/billing SDKs. The source checker is not a merged-manifest or dependency-graph inspection.

In the Amazon Developer Console:

1. Submit the **Fire tablet APK** and set the one-time paid price in the store. No in-app purchase setup is needed by this implementation.
2. Keep app ID `app.scanandorganize.documents`, local origin and signing/update identity stable. Increase `versionCode` on later releases.
3. Select only tablet models/firmwares you have validated. Manifest filtering alone cannot enforce the WebView engine floor. Clearly state the Fire OS/WebView requirements in the listing.
4. Choose **No** for **Allow Amazon to Apply DRM?**, if offered. Do not add SDK-based licensing/DRM to this offline build. Amazon documents the difference between DRM-enabled entitlement checks and the No-DRM path. [5](https://developer.amazon.com/docs/app-submission/understanding-submission.html)
5. Test the **Amazon-processed build** using Amazon's available testing/distribution workflow before release—not just your locally signed/sideloaded APK. Appstore signing/wrapping can differ from the local artifact. [5](https://developer.amazon.com/docs/app-submission/understanding-submission.html)

### Important: store-added code versus our source

Amazon documents that it wraps submitted Android binaries with Appstore communication/analytics code **even when automatic DRM is disabled**. It says the app communicates with the Appstore client at startup regardless of the DRM setting. [5](https://developer.amazon.com/docs/app-submission/understanding-submission.html)

**Our source adds no analytics, telemetry, login or licensing checks. That does not prove that Amazon's processed APK adds none.** Removing INTERNET in our manifest is not a guarantee about store-added code or the separate Appstore client's behavior. Do not promise zero platform telemetry or unconditional first-launch behavior based only on the sideloaded build. Review Amazon's current policies/privacy disclosures and test the processed APK offline. If zero store-added analytics is non-negotiable, resolve this conflict with Amazon before publishing; it cannot be fixed by this app's source alone.

## Fire device release gate

Record **model/generation, Fire OS build, Android API, ABI, Amazon WebView package/version, app version and APK source** for each result. Inspect locally, without uploading device data:

```sh
adb shell getprop ro.product.model
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abilist
adb shell dumpsys webviewupdate
adb shell dumpsys package com.amazon.webview.chromium
```

- [ ] Stock Fire tablet, **no sideloaded Google services/apps**. Install/update the system software beforehand as necessary; record the actual WebView version.
- [ ] Fresh app install, then airplane mode **before the first app launch**. Repeat with Amazon's processed build and a later upgrade. Installation/system updates themselves are outside the app's offline-runtime guarantee.
- [ ] Rear/fixed-focus camera, deny/permanently deny/one-time permissions, retry, background/resume, portrait/landscape and photo selection.
- [ ] Crop, both filters, retake, touch reorder/delete, save to every folder type, search, restart/force-stop and retained page order.
- [ ] Local PDF save to internal storage and an inserted SD card where supported. Reopen the actual PDF and verify all pages/order. Cancel/retry, no file provider, low storage, inaccessible destination and restricted profiles.
- [ ] Native Share fallback with a real installed target, including read access after the sheet closes; never a blob-download prompt.
- [ ] Hardware Back, system navigation bars, keyboard, larger font settings, and launcher icon on Fire OS 7 and 8.
- [ ] Near-limit documents on the lowest-memory supported tablet. No `largeHeap` assumption; no blank frames, partial PDFs shared, or process kills.
- [ ] Upgrade without uninstalling or clearing data; old documents still load. Debug/release/Appstore signatures may differ, so do not uninstall a user's copy just to sideload a mismatched build.

Run the real-device instrumentation tests described in [ANDROID-TESTING.md](ANDROID-TESTING.md), plus this manual gate. **No physical Fire tablet or Amazon-processed APK has been tested in this environment.**
