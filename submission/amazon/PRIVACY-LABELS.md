# Privacy-label worksheet — review, do not blindly paste

The supplied source processes sensitive user-controlled document content locally and can hand an exported PDF to another provider/application. **Local processing is not a sufficient reason to automatically answer "No" to every Amazon privacy question.** Review the exact definitions and the actual compiled and Amazon-processed APK.

Amazon asks about both collection and transfer to third parties, including applicable behavior of third-party code. It requires a complete questionnaire for new submissions and updates. [2](https://developer.amazon.com/docs/app-submission/appstore-privacy-labels.html)

## Source-based data inventory

| Data / access | What the application code does | What to consider in the questionnaire |
| --- | --- | --- |
| Camera sensor frames and chosen photos | Live camera preview and page capture; JPEG page images saved locally after Save. No audio recording or saved video files. | Photos/camera data are used for app functionality. Camera access is optional if the user imports a photo. Do not deny camera use just because there is no upload. |
| Files/docs, thumbnails, filenames, folder names, dates and page order | IndexedDB/localStorage inside the app's local origin. | Files and docs / associated metadata are central to the app. Documents may contain personal, financial, health or identity information chosen by the user. No OCR or extraction of those fields is implemented. Review how Amazon classifies arbitrary document content. |
| Search text | Name filtering in app memory; no separate search-history log or transmission by this code. | Distinguish temporary functionality from stored/transmitted search history according to the questionnaire. |
| Exported PDFs | Generated in private cache; written to a user-selected file provider, or passed to an app through the native share sheet. | Explicit user-directed transfer must be considered. Selected recipients/providers may themselves sync or transmit the file. Do not claim that sharing is impossible. |
| Device/advertising IDs, analytics and diagnostics | No publisher-integrated tracking, advertising, analytics or crash-upload SDK. | Inspect the final artifact and Amazon wrapper separately; source dependencies alone cannot establish every processed-build data practice. |
| Payment details | No purchase flow or card entry in the app. Amazon handles paid download. | Amazon says external payment data entered outside the app, unavailable to the developer, need not be disclosed as collected/transferred by the app. Do not claim card data is collected by this code merely because the store charges for download. [2](https://developer.amazon.com/docs/app-submission/appstore-privacy-labels.html) |
| Support emails | User voluntarily contacts the configured public support address, outside the scanner. | The publisher/email provider receives the sender address and content. Review this separate support handling and retention in the policy. |

The primary purpose of app-handled photos/docs is **app functionality**. There is no document-data advertising, personalization, resale or background cloud sync implemented in the source. Do not invent security guarantees: PDFs are unencrypted, and the application adds no extra encryption or password vault.

## Before answering the first Yes/No question

A conservative starting point for review is **Yes**, because this app handles photos/documents and supports explicit transfers. This is not a legal determination or a replacement for Amazon's definitions. If Amazon's form provides specific local-processing or user-directed-transfer exclusions, apply them only after verifying they actually fit. Ask Amazon developer support if the treatment is unclear rather than guessing.

Review all applicable third-party behavior. Amazon documents Appstore communication/analytics wrapping even when automatic DRM is off; do not assert that the processed APK has none merely because our source has no analytics SDK. [1](https://developer.amazon.com/docs/app-submission/understanding-submission.html)

## Policy and user controls

- Complete and approve `config/publisher.json` and `config/privacy-policy.json`.
- Host the generated policy at the real public HTTPS URL and verify it while signed out.
- Rebuild the APK after changes so its offline Privacy & support view matches the public policy.
- Describe camera permission revocation, document deletion, cache lifetime, independent exported copies, and data loss after app-data clearing/uninstall.
- No app account is created, so there is no app-account deletion flow to claim. Device-library deletion and email-support requests are different actions.
- The policy must accurately identify the publisher and support contact. Do not submit placeholder details or claim legal adequacy solely because a template exists. Amazon's privacy/security policy expressly covers camera data and privacy disclosures in the app and on its detail page. [1](https://developer.amazon.com/docs/policy-center/privacy-security.html)

Only set `publication.privacyQuestionnaireReviewed` to true in `submission.json` after the publisher has completed this review and the console questionnaire for the actual release.
