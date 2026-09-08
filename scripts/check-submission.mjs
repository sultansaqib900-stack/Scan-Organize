import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { publisherIssues } from '../lib/publisher.mjs';

const root = 'submission/amazon';
const allowedSizes = [[800, 480], [1024, 600], [1280, 720], [1280, 800], [1920, 1080], [1920, 1200], [2560, 1600]];
export const supportedScreenshotSize = (width, height) => allowedSizes.some(([w, h]) => (width === w && height === h) || (width === h && height === w));

/** These are publisher confirmations, not facts inferred from passing code tests. */
export function submissionFieldIssues(metadata, publisher, publish = false) {
  const issues = publisherIssues(publisher);
  const money = metadata.monetization || {};
  if (money.model !== 'paid-upfront' || money.inAppPurchases !== false || money.subscriptions !== false || money.advertisingSdk !== false) issues.push('Keep paid-upfront pricing with no IAP, subscription or advertising SDK.');
  if (typeof money.basePrice !== 'number' || !Number.isFinite(money.basePrice) || money.basePrice <= 0) issues.push('Choose the one-time base price; do not leave the console on Free.');
  if (!/^[A-Z]{3}$/.test(money.currency || '')) issues.push('Choose the base currency offered by the Amazon console.');
  if (money.automaticDrm !== 'No') issues.push('DRM must remain No for the current no-runtime-license-check design. Review the piracy/offline tradeoff before changing this.');
  if (money.paidSettingConfirmedInConsole !== true) issues.push('Confirm Paid and the intended regional prices in the Amazon console.');
  const publication = metadata.publication || {};
  if (!Array.isArray(publication.countries) || !publication.countries.length) issues.push('Choose and review the distribution countries.');
  const confirmations = {
    publisherAccountPaymentTaxSetupComplete: 'Complete required payment/banking/tax setup privately in the Amazon console.',
    contentRatingQuestionnaireReviewed: 'Complete and review the content-rating questionnaire.',
    privacyQuestionnaireReviewed: 'Complete and review privacy labels, including exports and third-party/store code.',
    publicPrivacyUrlChecked: 'Verify the public HTTPS policy loads without login and matches the approved policy.',
    fireDeviceTestsPassed: 'Record passing camera, storage, PDF and first-launch-offline tests on target Fire devices.',
  };
  for (const [key, message] of Object.entries(confirmations)) if (publication[key] !== true) issues.push(message);
  if (publish && publication.amazonProcessedBuildTested !== true) issues.push('Before going live, test Amazon\'s processed build using the available testing workflow.');
  return issues;
}

async function sha256(file) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex');
}

async function checkSubmission() {
  const assetsOnly = process.argv.includes('--assets-only'), publish = process.argv.includes('--publish');
  const metadata = JSON.parse(await readFile(`${root}/submission.json`, 'utf8'));
  const publisher = JSON.parse(await readFile('config/publisher.json', 'utf8'));
  const failures = [];
  const text = async name => (await readFile(`${root}/listing/${name}`, 'utf8')).trim();
  const title = await text('title.txt'), short = await text('short-description.txt'), long = await text('long-description.txt');
  const features = (await text('features.txt')).split('\n').filter(Boolean);
  if (!title || title.length > 200) failures.push('Title must be 1–200 characters.');
  if (!short || short.length > 1200 || Buffer.byteLength(short) > 2000 || /\r|\n/.test(short)) failures.push('Short description must be a single paragraph within 1,200 English characters / 2,000 UTF-8 bytes.');
  if (!long || long.length > 4000) failures.push('Long description must be 1–4,000 characters.');
  if (features.length < 3 || features.length > 5) failures.push('Provide 3–5 product-feature lines.');
  if ([title, short, long, ...features].some(value => /<\/?[a-z][^>]*>/i.test(value))) failures.push('Store description fields must be plain text, not HTML.');
  for (const size of [114, 512]) {
    const image = await sharp(`${root}/assets/icon-${size}.png`).metadata();
    if (image.format !== 'png' || image.width !== size || image.height !== size || !image.hasAlpha) failures.push(`icon-${size}.png must be an exact-size RGBA PNG.`);
  }
  const promo = await sharp(`${root}/assets/promo-1024x500.png`).metadata();
  if (promo.format !== 'png' || promo.width !== 1024 || promo.height !== 500) failures.push('Optional promotional image must be 1024x500 PNG.');
  if (!assetsOnly) {
    failures.push(...submissionFieldIssues(metadata, publisher, publish));
    const shots = metadata.screenshots || [];
    if (shots.length < 3 || shots.length > 10) failures.push('Provide 3–10 reviewed screenshots from the final Fire build.');
    for (const shot of shots) {
      try {
        const path = resolve(root, shot.file || '');
        if (!path.startsWith(resolve(root, 'screenshots') + sep)) throw new Error('Screenshot must be in submission/amazon/screenshots.');
        const image = await sharp(path).metadata();
        if (!['png', 'jpeg'].includes(image.format) || !supportedScreenshotSize(image.width, image.height)) throw new Error('Unsupported screenshot format/dimensions; never stretch UI images.');
        if (shot.origin !== 'fire-device' || shot.reviewed !== true || !shot.deviceModel) throw new Error('Record Fire-device provenance and review the shot for personal information and release-UI accuracy.');
        if (!shot.sha256 || shot.sha256 !== await sha256(path)) throw new Error('Record the current screenshot SHA-256.');
      } catch (error) { failures.push(`${shot.file || 'Screenshot'}: ${error.message}`); }
    }
    try {
      const file = metadata.apk?.path;
      if (!file || !(await stat(file)).isFile()) throw new Error('Set apk.path to the actual local signed release APK.');
      const hash = await sha256(file);
      if (metadata.apk.sha256 !== hash) throw new Error('Set apk.sha256 to the verified release artifact hash.');
      const report = JSON.parse(await readFile(`${root}/${metadata.apk.report}`, 'utf8'));
      if (report.passed !== true || report.apkSha256 !== hash) throw new Error('Run amazon:apk-check on this exact APK and resolve any failures.');
      const sourceHash = createHash('sha256').update(await readFile('config/publisher.json')).update('\0').update(await readFile('config/privacy-policy.json')).digest('hex');
      if (report.sourcePrivacySha256 !== sourceHash) throw new Error('The APK report is stale after a privacy/source change. Rebuild and inspect again.');
    } catch (error) { failures.push(error.message); }
  }
  console.log(`Listing: ${title.length}-character title, ${short.length}-character short description, ${long.length}-character long description, ${features.length} features.`);
  console.log('Store PNG checks completed. Requirements: [1](https://developer.amazon.com/docs/app-submission/appstore-details.html)');
  if (failures.length) {
    console.error(`\nNOT READY — ${failures.length} item(s) need attention:\n` + failures.map(item => `- ${item}`).join('\n'));
    process.exitCode = 1;
  } else if (assetsOnly) {
    console.log('Copy and artwork checks passed. Publisher details, APK, screenshots, console settings and device tests have NOT been approved by this check.');
  } else {
    console.log('Recorded submission checks passed. This is not Amazon approval or independent verification of publisher attestations.');
    if (!publish) console.log('After upload, test the Amazon-processed build before going live; use --publish for that additional gate.');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await checkSubmission(); }
  catch (error) { console.error(`Submission check could not finish: ${error.message}. Run npm run amazon:assets first.`); process.exitCode = 1; }
}
