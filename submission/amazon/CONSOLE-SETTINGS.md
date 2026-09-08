# Amazon console settings — paid download

This is a preparation worksheet, not confirmation that your Amazon account has been changed. Current workflow references: Upload App File → Target Your App → Appstore Details → Review and Submit. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

## Upload Your App File

- App type: Android/Fire OS APK, not a web-app URL or Vega package.
- Intended platform: Fire tablets only. Do not enable Fire TV/Stick, Kindle e-readers or Echo products.
- Upload the signed **release** APK containing the final approved offline privacy policy, not an old APK built before that feature or a debug APK.
- Expected package: `app.scanandorganize.documents`; initial source version `1.0` / code `1`. Inspect the actual APK and keep this worksheet synchronized if you change the version.
- Confirm local bundled assets, no live `server.url`, and correct camera/file bridges. Do not make an ARM64-only APK if it would exclude intended 32-bit Fire models.
- Apply Amazon DRM? **No for this offline-first release**, if the option is offered. This is separate from charging for the download. Amazon describes the optional DRM field and SDK-based alternative. [4](https://developer.amazon.com/docs/app-submission/upload-app-file.html)

## Target Your App

- Category suggestion: **Productivity** (choose the matching available category in the console).
- Language: English for the prepared copy. Do not enable unsupported-language descriptions by copying English into every locale.
- Territories: **publisher decision pending**. Review countries where you can support the app and sell it; do not infer them from your current location.
- Device eligibility: Fire OS 7/8, API 28+, and Amazon System WebView based on Chromium 111+. Only enable models you have actually tested with supported Amazon software. The manifest cannot filter customers by WebView engine version. [7](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html)
- Target audience: general-purpose utility, not a child-directed app. Do not claim restricted child-profile support without testing it.
- Content rating: answer the real questionnaire. The supplied app has no adult/violent/gambling content, public social feed or built-in chat. Users can create private scans and explicitly share PDFs; do not ignore those capabilities if a question asks about user-created content or communication. Amazon determines the final rating—do not substitute a guessed rating.
- User-data privacy: complete the questionnaire and supply the approved public policy URL. Use `PRIVACY-LABELS.md`; do not automatically select "No data collected" because the library is local. Amazon requires complete privacy questionnaires for new apps and updates. [2](https://developer.amazon.com/docs/app-submission/appstore-privacy-labels.html)
- Public support contact: use the same monitored address and publisher identity as `config/publisher.json`.

## Appstore Details → Pricing

| Setting | Required choice |
| --- | --- |
| Free or Paid | **Paid** |
| Base price | **Publisher to choose** |
| Base currency | **Publisher to choose from console options** |
| Regional list prices | Review Amazon-calculated prices or set each deliberately |
| IAP products | None |
| Subscriptions | None |
| Trial or in-app unlock | None |
| Payment/banking/tax account details | Complete privately in Amazon's developer profile |

Amazon's console defaults to Free. Select Paid and enter your base price/currency; it can calculate other marketplace prices, or you can set them yourself. The console enforces currency-specific minimum prices. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

**Do not add a Buy, Subscribe, license-login or payment button inside the app.** The customer pays through the store before download. There is no reason to create a consumable, entitlement or subscription SKU for this business model.

**No DRM tradeoff:** paid download controls legitimate store acquisition, while DRM controls runtime entitlement checks. The SDK/DRM is optional for selling an app; without it, a copied APK can run without that check. Amazon notes that DRM-enabled apps can require periodic internet access. Keep DRM off unless you explicitly decide to change the offline requirements and retest that path. [3](https://developer.amazon.com/docs/in-app-purchasing/drm-overview.html)

## Description, images and reviewer access

- Display title: copy `listing/title.txt`.
- Short/long descriptions: copy the respective `.txt` files without HTML or Markdown.
- Product features: copy the five lines in `listing/features.txt`.
- Keywords: optional comma-separated terms in `listing/keywords.txt`.
- Release notes: `listing/release-notes.txt`, where requested.
- Testing instructions: `listing/reviewer-instructions.txt`. No scanner login/test account is required.
- Tablet artwork: 114×114 and 512×512 PNG icons; optional 1024×500 promotional PNG. Add 3–10 screenshots of the actual final app. Do not upload desktop frames, fabricated native pickers, device mockups or personal documents. [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)

## Review and Submit

- Review all missing-field warnings in the console and `amazon:submission-check`.
- Match the uploaded file's version, package and SHA-256 to the tested artifact.
- Check the public policy URL while signed out, and check its offline in-app copy.
- Verify camera denial/retry, persistence, first offline launch, local PDF saving and Share fallback on stock Fire hardware.
- Inspect and test Amazon's processed build through its available testing workflow before going live. Amazon documents signing/wrapping changes and Appstore communication even without optional DRM. [1](https://developer.amazon.com/docs/app-submission/understanding-submission.html)
- Submit through your own authenticated developer account. Do not send account credentials, signing keys, tax records or bank details to the assistant.
