import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Source guardrails, NOT an APK/device or Appstore certification test. */
export async function checkAmazonSources(root = process.cwd()) {
  const read = path => readFile(join(root, path), 'utf8');
  const problems = [];
  const check = (condition, message) => { if (!condition) problems.push(message); };
  const manifest = (await read('android/app/src/main/AndroidManifest.xml')).replace(/<!--[\s\S]*?-->/g, '');
  const variables = await read('android/variables.gradle');
  const capacitor = (await read('capacitor.config.ts')).replace(/^\s*\/\/.*$/gm, '');
  const gradle = (await read('android/build.gradle')) + '\n' + (await read('android/app/build.gradle'));
  const main = await read('android/app/src/main/java/app/scanandorganize/documents/MainActivity.java');
  const saver = await read('android/app/src/main/java/app/scanandorganize/documents/PdfSavePlugin.java');
  const packages = JSON.parse(await read('package.json'));
  const dependencyNames = Object.keys(packages.dependencies || {});

  check(/minSdkVersion\s*=\s*28\b/.test(variables), 'Fire tablet release floor must be Fire OS 7 / API 28.');
  check(/targetSdkVersion\s*=\s*36\b/.test(variables), 'Retain the current API 36 target; it is not the minimum device API.');
  check(/minWebViewVersion:\s*111\b/.test(capacitor), 'Retain the tested Next.js/Chromium 111 WebView floor.');
  check(/webDir:\s*['"]out['"]/.test(capacitor) && !/\burl\s*:/.test(capacitor), 'Ship bundled out/ assets, never a live server.url.');
  for (const feature of ['android.hardware.touchscreen', 'android.hardware.camera.any']) {
    check(manifest.includes(`android:name="${feature}" android:required="true"`), `Require ${feature} for the tablet listing.`);
  }
  check(manifest.includes('android:name="android.hardware.camera.autofocus" android:required="false"'), 'Do not exclude fixed-focus Fire tablet cameras.');
  for (const permission of ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE']) {
    check(manifest.includes(`android:name="${permission}" tools:node="remove"`), `Remove ${permission} from our APK.`);
  }
  check(!/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|RECORD_AUDIO/.test(manifest), 'No broad storage, package enumeration, or microphone permission.');
  check(manifest.includes('android:allowBackup="false"') && manifest.includes('android:fullBackupContent="false"'), 'Disable platform automatic backup for local-only documents.');
  check(manifest.includes('android.intent.action.CREATE_DOCUMENT') && manifest.includes('application/pdf'), 'Declare narrow native PDF picker visibility.');
  check(!manifest.includes('LEANBACK_LAUNCHER'), 'This is not a Fire TV/remote-control app.');
  check(!/\babiFilters\b/.test(gradle), 'Do not filter out 32-bit Fire tablet ABIs.');
  check(!/com\.google\.android\.gms|com\.google\.firebase|com\.android\.billingclient|google-services/.test(gradle), 'No Google Play services, Firebase, or billing dependency. Google Maven for build tooling is fine.');
  check(!dependencyNames.some(name => /firebase|play-billing|amazon.*(?:iap|appstore-sdk)|appstore-sdk/i.test(name)), 'Keep payments, login, DRM and analytics SDKs out of the application.');
  check(main.includes('registerPlugin(PdfSavePlugin.class)') && main.includes('registerPlugin(CameraAccessPlugin.class)'), 'Register both local camera and PDF-save bridges.');
  check(saver.includes('Intent.EXTRA_LOCAL_ONLY') && saver.includes('getCanonicalFile()') && saver.includes('new byte[64 * 1024]'), 'Retain local-only intent, private-source validation, and streamed PDF copying.');
  check(!saver.includes('.isBlank(') && !saver.includes('.readAllBytes('), 'Avoid newer Java-library APIs unavailable on Fire OS 7.');
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    try { await access(join(root, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`)); }
    catch { problems.push(`Missing legacy launcher PNG for ${density}.`); }
  }
  try {
    await access(join(root, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'));
    problems.push('Do not override the Fire-compatible raster launcher with an adaptive icon.');
  } catch { /* Legacy density PNGs are intentional. */ }
  return problems;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const problems = await checkAmazonSources();
  if (problems.length) {
    console.error(problems.map(problem => `FAIL: ${problem}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Amazon Fire tablet source guardrails passed.');
    console.log('This does not compile/test an APK or inspect Amazon\'s post-upload wrapper. Run the physical Fire/Appstore checklist before release.');
  }
}
