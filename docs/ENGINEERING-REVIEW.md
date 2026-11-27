# Scan & Organize — Engineering Review

**Reviewer:** Arena agent · **Date:** 25 Oct 2026 · **Branch:** `arena/1c1cfbf5-scan-organize` @ `ac54d49`
**Verdict:** Solid, unusually disciplined v1 codebase. **Not release-ready** — 4 concrete blockers, mostly in dependency hygiene, CSP enforcement and release evidence (not in the app logic, which is the strongest part of this repo).

---

## 1. What the app is

An offline-only document scanner for Amazon Fire tablets. Next.js 16 static export (`output: 'export'`) wrapped in a thin Capacitor 8 Android shell. No backend, no API routes, no accounts, no analytics, no billing SDK.

```
app/              2 files   root layout (CSP, viewport) + single client page
components/      11 files   library, sidebar, scan flow (camera → crop → review), viewer, dialogs
lib/              7 files   model, IndexedDB storage, perspective warp + filters, jsPDF export, native bridges
android/          3 Java    BridgeActivity, CameraAccessPlugin, PdfSavePlugin + release privacy gate
scripts/          9 files   build/preview wrappers, privacy + SW generation, release & submission validators
tests/           12 files   51 unit (vitest) + 20 e2e specs (Playwright) + 5 native instrumentation tests
```

**Size:** 1,321 LOC TypeScript/TSX · 486 LOC CSS · 373 LOC Java · ~700 LOC tooling/tests · 538 lines of docs. 124 tracked files. Shipped bundle: 46 files, 1.65 MB.

### Data model
Documents (metadata + thumbnail) and pages (JPEG blobs + dimensions) live in IndexedDB (`scan-organize`, stores `documents` / `pages`, indexes on `folderId` / `documentId`). Folder names live in `localStorage`. Document save and delete are single transactions across both stores — no partial writes.

### Scan pipeline
`getUserMedia` → `captureFrame` (≤2200 px long edge, JPEG) → manual 4-corner drag with a **true projective homography** (not a rectangular crop) → bilinear resample → either contrast/sharpening ("clean colour") or integral-image adaptive threshold (B&W) → page list with drag/keyboard reorder → atomic save.

### Export pipeline
jsPDF (one A4 page per scan, orientation preserved, JPEG passthrough with `'FAST'`) → base64 chunks of **256 KiB** over the Capacitor bridge into `Cache/exports/…` → `ACTION_CREATE_DOCUMENT` SAF picker via a custom plugin (canonical-path validated, 64 KiB streamed copy) → fallback to native Share **only** when the picker is unavailable, never on cancel or write failure → browser download is used only in the non-native preview.

---

## 2. Verification performed

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | ✅ clean |
| Types | `npm run typecheck` (strict) | ✅ clean |
| Unit tests | `npm test` | ✅ 51/51 passed (7 files, 3.9 s) |
| Production build | `npm run build` | ✅ static export, 46 files / 1.65 MB, SW cache `2c19a0ba…` |
| Dependency audit | `npm audit --omit=dev` | ❌ **4 vulnerabilities — 2 critical, 2 high** |
| E2E / a11y | `npm run test:e2e` | ⚠️ **not runnable here** — Playwright browser download blocked in this sandbox |
| Android build / device | — | ⚠️ no JDK/SDK/device available |

Everything below marked *verified* was reproduced in this session. Everything else is code review.

---

## 3. Findings

### P0 — release blockers

**F1. Critical advisories in the shipped dependency chain; docs claim the opposite.** *(verified)*
`npm audit --omit=dev` reports:

| Package | Severity | Reached via | Fix |
| --- | --- | --- | --- |
| `next@16.3.4` | **critical** | direct (13 advisories: RCE in `ImageResponse`, SSRF/RCE in Image Optimization, cache poisoning, `use cache` leaks) | 16.4.3 (non-major) |
| `dompurify@3.4.15` | **critical** | optional dep of `jspdf@4.2.1`, **bundled into `out/`** (`0scja3t8tj723.js`, `13dz3f165d_8d.js`) | ≥3.4.17 via `overrides` |
| `sharp@<0.35.5` | high | transitive, build-time only (`build-submission-assets.mjs`) | 0.35.5 |
| `source-map-js@≤1.2.1` | high | transitive, build-time only | 1.2.2 |

Real-world exploitability here is low: this app has no Node server, no image optimizer at runtime, and never calls `jsPDF.html()`. But it ships a store-bound APK whose embedded JS contains a library with a critical XSS advisory, and it makes `README.md:118` and `submission/amazon/VALIDATION-STATUS.md:12` ("dependency audit reported no vulnerabilities") factually false — which is worse than the vulnerability itself for a store submission. **Fix:** bump Next, add `"overrides": { "dompurify": "^3.4.17" }`, re-audit, and correct both documents.

**F2. The Content-Security-Policy does not cover most of the app.** *(verified)*
`app/layout.tsx:24` renders the CSP as a `<meta http-equiv>` inside `<head>`. Next 16 emits its own preload/script tags first, so in `out/index.html` the CSP starts at byte **1439**, after six `<script src=… async>` tags at bytes 388, 458, 528, 608, 678, 748. Per the HTML spec a meta CSP only governs content *after* it, so the framework runtime and initial app chunks load with **no CSP at all**. The only remaining protection is `script-src 'unsafe-inline'`, which is already the weakest part of the policy.
In the APK the meta tag is the only delivery mechanism (Capacitor serves assets without custom headers), so this is a real regression, not a dev-only artifact. **Fix:** hoist the meta to the very first child of `<head>` (or post-process `out/*.html` in `scripts/build-offline.mjs`, which already walks every exported file) and add a regression assertion: `index(CSP) < index(first <script>)`. See §5 for the test.

**F3. Release identity is empty, so the app ships a policy stamped "Draft — do not publish".** *(verified)*
`config/publisher.json` is entirely blank (`publisherName`, `supportEmail`, `privacyPolicyUrl`, `effectiveDate` empty, `policyApproved: false`). Consequences: `out/privacy.html` and the committed `submission/amazon/privacy-policy.html` both render the DRAFT banner; `publisherIssues()` returns 5 issues; `verifyReleasePrivacy` (Gradle) throws on `preReleaseBuild`; `amazon:submission-check` reports NOT READY. The gating logic is correct and well built — but it means "builds green" ≠ "shippable", and a debug APK handed to a reviewer today would show a draft policy. **Fix:** complete the config before any APK leaves the machine; decide whether a draft policy should be *viewable* in a debug build at all.

**F4. `dd.txt` — 820 KB of patch dump committed to the repo root.** *(verified)*
`git ls-files` includes it; it is a full `diff --git` dump of the entire project (`.gitignore`, `README`, and more). It is dead weight in every clone, will end up in any repo archive, and is the kind of file that leaks history or internal notes. **Fix:** `git rm dd.txt`, add a guard (`.gitignore` entry plus a `check-amazon` assertion that no `*.txt`/`*.patch` dump exists at root).

### P1 — should fix before the next release

> **Addressed in this branch.** F8 (non-idempotent IDB upgrade) is fixed as part of the verified-vault work, which introduces schema version 2 and therefore had to make the upgrade path safe first; `tests/unit/storage-integrity.test.ts` now opens a real version-1 database and asserts nothing is lost. F12's blast radius is reduced by `deliverBlob`, but jsPDF is still used.

**F5. Peak memory in the scan pipeline is unbounded in practice.** *(code review)*
At `MAX_IMAGE_EDGE = 2200`, a 2200×1650 capture allocates, per processed page:

| Buffer | Where | Size |
| --- | --- | --- |
| source canvas backing store | `image-processing.ts:154` | ~14.5 MB |
| `getImageData().data` (`pixels`) | `:155` | 14.5 MB |
| output `ImageData` | `:158` | 14.5 MB |
| colour-filter copy | `:100` | 14.5 MB |
| B&W `gray` + `integral` | `:117`, `:119` | 3.6 + 14.5 MB |
| output canvas backing store | `:157` | 14.5 MB |

Peak ≈ **60–90 MB transient** on top of 40 draft JPEG blobs and the live camera stream. Fire HD 8-class devices give a WebView a few hundred MB, so this is survivable but close, and there is no guard, no downscale-before-warp step, and **no test that exercises a large image** (fixtures are small). **Fix:** warp from a ≤1400 px proxy, reuse a single scratch buffer, free `pixels` before encoding, and add a `processScan` test at 2200 px asserting peak allocation bounds.

**F6. All image processing runs on the main thread.**
`processScan` + `applyScanFilter` yield with `setTimeout(0)` every 64/96/128 rows, so the UI isn't frozen, but a 2200 px warp with bilinear interpolation in JS is a multi-second task on weak ARM cores and aggressively throttled while yielding (hundreds of macrotasks). The overlay says "Making a cleaner page…" so it reads as intended, but a Web Worker would make it genuinely non-blocking and is a contained change (the functions are already pure over `Uint8ClampedArray`).

**F7. No React error boundary.**
Any render/hook exception in `Workspace` (e.g. `ResizeObserver` missing on an old WebView, a bad stored record) unmounts the whole client tree and leaves a blank `https://localhost` page inside the APK with no recovery, no way back to the library, and no diagnostic. For an offline app with no telemetry this is the worst possible failure mode. **Fix:** a small `app/error.tsx` + a class boundary around `Workspace` that offers "Reload library" and keeps storage untouched.

**F8. IndexedDB upgrade handler is not idempotent — latent breakage on the first schema change.** *(verified by reading `lib/storage.ts:31-37`)*
`onupgradeneeded` unconditionally calls `createObjectStore('documents', …)` and `createObjectStore('pages', …)`. Today `DB_VERSION` is 1 so this only runs on a fresh database. The moment someone bumps to 2 with existing users, `createObjectStore` throws `ConstraintError`, the open request fails, `database` is reset, and every read/write fails with "On-device storage is unavailable" — for existing installs only, i.e. exactly the users with data. **Fix:** guard with `db.objectStoreNames.contains(...)` and add a v1→v2 migration test using `fake-indexeddb`.

**F9. Folders live in `localStorage`, documents in IndexedDB — two stores, no reconciliation.**
`readFolders()` / `writeFolders()` (`lib/storage.ts:55-84`) versus the IDB document store. They can desync (independent eviction, independent quota, `deleteFolder` mutates IDB then localStorage). The code handles the *safe* ordering well (move documents first, drop the folder second) and orphaned `folderId`s degrade to "invisible in folder view but visible on the home screen", so nothing is lost. Still, this is the one place where the architecture is weaker than the rest. **Fix:** move folders into the same IDB transaction; it removes an entire class of divergence and makes `deleteFolder` truly atomic.

**F10. Exported PDFs accumulate in the app cache forever.**
`writePdfToCache` (`lib/native-pdf.ts:25`) writes `exports/${Date.now()}-${name}.pdf` per export and nothing ever deletes them (deliberate: recipients may still read them). Over months of use this silently grows until Android clears the cache. **Fix:** prune `exports/` on app start (keep last N / older than 24 h) via `Filesystem.readdir` + `deleteFile`.

**F11. `buildPdf` hard-codes JPEG.** *(verified)*
`lib/pdf.ts:23` calls `addImage(bytes, 'JPEG', …)` for whatever blob is in `page.image`. Every current writer produces JPEG (`canvasBlob` → `image/jpeg`), but the invariant is implicit. A PNG blob (future format change, imported page, restored backup) produces a corrupt PDF silently. **Fix:** assert `page.image.type === 'image/jpeg'` in `saveDocument`, or branch on the type.

**F12. jsPDF drags a remote CDN loader string into the shipped bundle.** *(verified)*
`out/_next/static/chunks/0scja3t8tj723.js` contains `cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js` (jsPDF's PDFObject fallback). It is unreachable in every path this app uses, and the APK has no INTERNET permission, so nothing is ever fetched. But it directly contradicts the "no external runtime requests" claim in `README.md:3`, it would be a CSP violation if it ever fired, and static store scans do flag CDN strings. Since the only thing jsPDF does here is "draw a JPEG on A4 pages", replacing it with `pdf-lib` (already a devDependency, used in tests) or ~150 lines of a hand-rolled PDF writer would remove ~300 KB of bundle, one critical advisory, and this string at once. **Strong recommendation.**

**F13. The release evidence in the docs no longer matches the repo.**
`README.md:116-118` and `VALIDATION-STATUS.md` claim "51 unit tests and 37 browser/native-bridge contract tests", "no vulnerabilities", "audit reported no vulnerabilities". The unit count is right (51 ✅); the e2e count is not reproducible (20 `test(` declarations across 4 specs — 37 was the per-project executable count, which is legitimately different but unexplained); the audit claim is now false (F1). For a submission pack whose entire value is credibility, these need to be regenerated, not hand-maintained. **Fix:** a `npm run verify` that runs every gate and writes `submission/amazon/VALIDATION-STATUS.md` from real results.

### P2 — quality and polish

| # | Finding | Location | Note |
| --- | --- | --- | --- |
| F14 | `useObjectUrl` can render one frame pointing at a **revoked** URL: cleanup revokes the old URL before the effect sets the new one, and the render between them returns the stale `url` state | `lib/hooks.ts:5-16` | Track `{blob, url}` together and return `url` only if `state.blob === blob` |
| F15 | Sandbox leftovers in a shipped config: `allowedDevOrigins: ['*.e2b.app']` and `experimental: { cpus: 2 }` | `next.config.js:8-9` | Dev-only, but it leaked from the agent environment; `cpus` also prints a build warning |
| F16 | `versionCode 1` / `versionName "1.0"` hard-coded; no bump automation | `android/app/build.gradle:12-13` | Amazon rejects a re-upload with an unchanged `versionCode` |
| F17 | Native back-button listener re-registers on **every keystroke** in search | `components/workspace.tsx:82` (`[activeFolder, query]`) | Each cycle is an async import + bridge `addListener`/`removeListener`; use a ref for state |
| F18 | `formatDate` converts a UTC ISO string to local time — a scan at 00:30 local can display the previous day | `lib/model.ts:47` | Use the local date of capture, or store a local date string |
| F19 | `toLocaleLowerCase()` with no locale for duplicate checks and search | `lib/storage.ts:89,100`, `workspace.tsx:91` | Turkish dotted/dotless I gives false duplicates/non-matches; use `toLowerCase()` |
| F20 | Saving a document force-navigates the user into its folder, overriding where they were | `components/workspace.tsx:115` | `setActiveFolder(saved.folderId)`; consider staying put with a toast |
| F21 | Viewer arrow-key paging is bound to a non-focusable `<div>` | `components/document-viewer.tsx:51` | Works only when focus is already inside the dialog; make the shell `tabIndex={-1}` + autofocus |
| F22 | `readFolders()` performs a **write** as a side effect (seed defaults / repair) | `lib/storage.ts:64-77` | A pure read can throw on quota; return the repaired list and persist separately |
| F23 | a11y gaps outside the two axe-covered surfaces (library, privacy): crop handles expose no value/range, carousel has no `role`, off-screen pages are `aria-hidden` but still mounted | `corner-editor.tsx:64`, `document-viewer.tsx:52` | Add axe runs for the scan flow and viewer |
| F24 | `Toast` attaches a `MutationObserver` to the whole `document.body` subtree for its lifetime | `components/ui.tsx` | Fine at this scale; scope it to the body's direct children |
| F25 | `check-amazon.mjs` asserts on **source text** (regex over `manifest`/`gradle`/Java), so a comment can satisfy a check | `scripts/check-amazon.mjs` | It strips XML comments only; prefer parsing where cheap |
| F26 | `publisher.mjs` is JavaScript with JSDoc types imported into the TS app *and* the release gate | `lib/publisher.mjs` | The code that decides "may this be published" is the least type-checked file in the repo; port to `.ts` |
| F27 | No i18n seam: strings hard-coded, `Intl` locale fixed to `'en'` | throughout | Fine for v1; note that `lang="en"` + `en-US` store locale is a deliberate constraint |

### Deliberate limits (confirmed, not defects)
Manual crop (no edge detection), no OCR/text layer in the PDF, no post-save page editing, 40 pages / 2200 px / 30 MB per photo, drafts lost on process kill, no encryption beyond the Android sandbox, unencrypted PDFs, left-over export cache visible to recipients. All are documented in `README.md:120-131` and surfaced in the UI copy. This kind of explicit limitation list is rare and valuable.

---

## 4. What this codebase does genuinely well

- **Failure semantics in storage.** Every multi-store operation opens `complete(tx)` *before* issuing requests, resolves on `oncomplete`, rejects on `onabort`, and deliberately ignores `onerror` so a partial save is never reported as success (`lib/storage.ts:15-21`). Quota/security errors are mapped to human sentences that tell the user their data is intact (`lib/model.ts:55-63`). This is the part most hobby scanners get wrong.
- **Native bridge discipline.** PDF writes are chunked at 256 KiB with a byte-exact test; the Java side validates the source URI against `cacheDir/exports` with `getCanonicalFile()`, rejects `/`, `\`, non-`.pdf` and >120-char names, streams at 64 KiB, uses `EXTRA_LOCAL_ONLY`, and distinguishes **cancel** from **failure** from **unavailable** so a cancellation never silently falls through to a different destination. The e2e suite asserts exactly that ordering.
- **Camera lifecycle.** A `generation` counter invalidates every in-flight `getUserMedia`/`play()` continuation, tracks are stopped on unmount, on `visibilitychange` and on Capacitor `appStateChange`, and the e2e suite verifies `readyState === 'ended'`. Denial/busy/missing each get an actionable message plus a photo-picker escape hatch.
- **Privacy posture is real, not marketing.** `INTERNET` and `ACCESS_NETWORK_STATE` are removed with `tools:node="remove"`; `allowBackup=false` + a full `data_extraction_rules` exclusion set; no broad storage permission; `usesCleartextTraffic=false`; a `FileProvider` limited to `exports/`; an in-app offline privacy view; and a Gradle `verifyReleasePrivacy` task that hashes `publisher.json`+`privacy-policy.json` and blocks `preReleaseBuild` on a stale or draft policy. The instrumentation test even asserts `checkSelfPermission(INTERNET) == DENIED` at runtime.
- **Offline story is built from the artifact.** `scripts/build-offline.mjs` hashes the *entire* export to version the service worker, excludes maps, and deliberately does not `skipWaiting` so an open app never mixes chunk versions.
- **Honest documentation.** Multiple places explicitly say what was *not* verified (no APK, no JDK, no Fire hardware, no Amazon-processed build). That is the correct posture and it makes the rest of the doc trustworthy.

---

## 5. Recommended sequence

1. **Unblock the release (half a day).** Bump `next` to ≥16.4.3, add the `dompurify` override, re-run `npm audit --omit=dev` to zero, and regenerate `VALIDATION-STATUS.md` from a real run rather than hand-editing it. *(F1, F13)*
2. **Hoist the CSP and prove it.** Emit the meta as the first `<head>` child (post-process in `build-offline.mjs` if Next keeps hoisting its tags), and add a unit test on `out/index.html` asserting `indexOf('Content-Security-Policy') < indexOf('<script')`. Consider dropping `'unsafe-inline'` from `script-src` if a nonce is feasible — otherwise document why not. *(F2)*
3. **Remove junk and sandbox leftovers.** `git rm dd.txt`, drop `allowedDevOrigins`/`experimental.cpus`, add root-level guardrails. *(F4, F15)*
4. **Harden the failure modes.** Error boundary, idempotent IDB upgrade + migration test, `versionCode` bump automation. *(F7, F8, F16)*
5. **Take the memory/scheduling work seriously.** Downscale-before-warp, buffer reuse, a 2200 px regression test, and then a Worker. This is the change most likely to prevent a 1-star review on a Fire HD 8. *(F5, F6)*
6. **Retire jsPDF.** `pdf-lib` is already in the tree for tests; a hand-rolled writer is ~150 lines. Removes the critical advisory, the CDN string, and ~300 KB. *(F12, F1)*
7. **Fill in `config/publisher.json`** and only then build a signing candidate. *(F3)*
8. **Then run the native gate:** `./gradlew connectedDebugAndroidTest` + the 5 instrumentation tests on a stock Fire HD 8 and 10, and the file-picker / share / background-camera manual checklist. Nothing in this repo substitutes for it.

### Tests I would add first
- `out/index.html`: CSP precedes the first `<script>` (F2).
- `storage.ts`: v1 → v2 upgrade against `fake-indexeddb` preserves documents and pages (F8).
- `image-processing.ts`: `processScan` at 2200 px on a real JPEG fixture, asserting output dimensions and that it completes (F5).
- `pdf.ts`: `buildPdf` given a PNG page rejects with a clear message (F11).
- An axe pass over the corner editor and the document viewer (F23).
- A CI job that runs `npm audit --omit=dev --audit-level=high` and fails, so F1 cannot silently return.

---

## 6. Limitations of this review

- Playwright browsers could not be downloaded in this environment, so the e2e/a11y suite (including the Chromium-111 claim) was **read, not executed**. Everything I state as "verified" comes from lint, typecheck, the 51 unit tests, the production build, `npm audit`, and direct inspection of `out/`.
- No JDK/Android SDK/device: the Java plugins, Gradle scripts and instrumentation tests were reviewed by reading only. The `aaptOptions` block under AGP 8.13, the manifest merge behaviour, and the picker/Share flows on stock Fire OS remain unverified here.
- No APK exists in the repo, so no claim about signing, packaged assets, actual permissions or `versionCode` in a built artifact could be checked.
