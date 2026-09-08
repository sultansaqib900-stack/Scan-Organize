# Scan & Organize — Amazon submission pack

**Business model: one-time payment in the Amazon Appstore before download.** No subscription, in-app purchase, payment screen or store SDK has been added to the app.

**Status: materials prepared; not submitted or approved.** No release APK was attached to this session, so its signing, manifest, contents and real-device behavior have not been verified. The source now includes an offline Privacy & support view; an older APK must be rebuilt to include it.

## 1. Supply the publisher details

Complete `config/publisher.json` in the project root:

- `publisherName`: your actual public developer/business identity.
- `supportEmail`: an address you monitor for customer support.
- `privacyPolicyUrl`: the final public HTTPS URL where you will host the policy.
- `effectiveDate`: the policy's actual effective date, in `YYYY-MM-DD` format.
- `policyApproved`: set to `true` only after reviewing `config/privacy-policy.json` against your practices and the final APK.

Do not invent these details or publish the draft. No account passwords, tax details, banking information or signing secrets belong in these files or in chat. Amazon's policy covers camera data and calls for the policy within the app and on the listing. [1](https://developer.amazon.com/docs/policy-center/privacy-security.html)

## 2. Finalize the policy and rebuild

```sh
npm ci
npm run amazon:release
npm run amazon:assets
npm run amazon:open
```

`amazon:release` validates publisher fields, generates the offline policy, builds the static export and syncs Capacitor. It does **not** sign or compile an APK. In Android Studio, generate a **signed release APK** using your own key. The release Gradle task rejects draft or stale bundled privacy details. Debug builds remain available for testing.

Host the generated `privacy-policy.html` at your configured URL. Verify it loads without login and matches the bundled policy. Do not point the listing at a draft, a local file, a private repository or an unverified URL. Hosting the policy does not create a runtime backend for the scanner.

## 3. Inspect the actual release APK

With JDK/Android SDK tools installed locally:

```sh
npm run amazon:apk-check -- /path/to/signed-release.apk
```

This read-only check uses `apksigner` and `apkanalyzer`; it does not upload or execute the APK. It checks the package/version, signature, debug flags, permissions, local assets, policy fingerprint, plugin classes and ABI coverage. Record the filename and SHA-256 in `submission.json`. Review any failures in `apk-report.json`.

A static APK inspection is not a camera, file-picker, memory or offline-first-launch test. Complete the physical-device checklist in `../../docs/AMAZON-APPSTORE.md`, using stock Fire tablets you intend to support.

## 4. Fill the Amazon console

Use `CONSOLE-SETTINGS.md`, `PRIVACY-LABELS.md`, and the plain-text files in `listing/`. Select **Paid**, then enter your approved base price/currency and review each marketplace price. The console defaults to Free, so do not skip this field. Paid apps also require the account's payment/banking/tax setup to be complete; do that privately in Amazon's console. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

Set the price and confirmation fields in `submission.json` only after making the corresponding decisions/checks. They are a checklist, not an API connection to your Amazon account.

## 5. Upload the artwork and genuine screenshots

| File | Use | Status |
| --- | --- | --- |
| `assets/icon-114.png` | Required small store icon | Prepared from vector artwork |
| `assets/icon-512.png` | Required large store icon | Prepared from vector artwork |
| `assets/promo-1024x500.png` | Optional promotional image | Prepared; title/art only |
| `listing/*.txt` | Title, descriptions, features, keywords, release notes, reviewer instructions | Prepared; review before copying |
| `privacy-policy.html` | Public policy page | **Draft until publisher details are approved** |
| `screenshots/` | 3–10 final Fire-device screenshots | **Awaiting captures; no screenshots were fabricated** |
| Signed release APK | App binary | **Not supplied or verified here** |

Follow `SCREENSHOTS.md`. The icon masters and promotional SVG are editing sources, not files to upload into PNG fields. Amazon specifies the icon dimensions, screenshot count/sizes and optional 1024×500 promotional image. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

## 6. Run the checklist, then submit yourself

```sh
npm run amazon:submission-check -- --assets-only  # copy/artwork checks
npm run amazon:submission-check                  # fields, APK report, screenshots, reviewer checks
npm run amazon:submission-check -- --publish     # additional processed-build go-live confirmation
```

Missing information produces **NOT READY**, rather than a false approval. You can create a draft/upload for testing before every final confirmation is complete. The Amazon-processed-build check is a later go-live gate, not a requirement to obtain a processed binary before the first upload.

Review the exact signed artifact and all console fields, then use Amazon's Review and Submit step. No app has been uploaded or submitted by this session. Approval, legal adequacy and device support cannot be guaranteed by this pack.

### Paid download is not the same as DRM

For the agreed offline-first behavior, this pack defaults to **Apply Amazon DRM? → No**. The paid download price still applies; no DRM means a copied APK is not protected by a runtime entitlement check. Amazon confirms the Appstore SDK/DRM is not required to sell an app. Enabling DRM is a separate business decision and changes the licensing/offline assumptions. [3](https://developer.amazon.com/docs/in-app-purchasing/drm-overview.html)

Amazon also documents store-added Appstore communication/analytics even with automatic DRM disabled. Keep that distinction in the policy and privacy-label review; do not claim that an analytics-free source proves an analytics-free processed APK. [1](https://developer.amazon.com/docs/app-submission/understanding-submission.html)
