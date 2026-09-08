import { readFile, stat, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const attribute = (tag, name) => tag.match(new RegExp(`${name.replaceAll(':', '\\:')}\\s*=\\s*"([^"]*)"`))?.[1];

/** Inspect decoded binary-manifest output, not the source manifest. */
export function inspectManifest(xml, expected) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const manifest = clean.match(/<manifest\b[^>]*>/s)?.[0] || '';
  const application = clean.match(/<application\b[^>]*>/s)?.[0] || '';
  const sdk = clean.match(/<uses-sdk\b[^>]*>/s)?.[0] || '';
  add('application ID', attribute(manifest, 'package') === expected.packageName, attribute(manifest, 'package') || 'missing');
  add('version', attribute(manifest, 'android:versionName') === expected.versionName && Number(attribute(manifest, 'android:versionCode')) === expected.versionCode, `${attribute(manifest, 'android:versionName')} (${attribute(manifest, 'android:versionCode')})`);
  add('SDK range', Number(attribute(sdk, 'android:minSdkVersion')) === expected.minSdk && Number(attribute(sdk, 'android:targetSdkVersion')) === expected.targetSdk, `min ${attribute(sdk, 'android:minSdkVersion')}, target ${attribute(sdk, 'android:targetSdkVersion')}`);
  add('not debuggable/test-only', Boolean(application) && !['true', '1'].includes(attribute(application, 'android:debuggable')) && !['true', '1'].includes(attribute(application, 'android:testOnly')), 'Release manifest must not enable debugging or testOnly.');
  add('backup disabled', attribute(application, 'android:allowBackup') === 'false' && attribute(application, 'android:fullBackupContent') === 'false', 'Both automatic backup flags must be false.');
  const permissions = [...clean.matchAll(/<uses-permission(?:-sdk-\d+)?\b[^>]*>/g)].map(match => attribute(match[0], 'android:name'));
  const allowed = new Set(['android.permission.CAMERA', `${expected.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`]);
  add('permissions', permissions.includes('android.permission.CAMERA') && permissions.every(permission => allowed.has(permission)), permissions.join(', '));
  for (const feature of ['android.hardware.touchscreen', 'android.hardware.camera.any']) {
    const tag = [...clean.matchAll(/<uses-feature\b[^>]*>/g)].map(match => match[0]).find(tag => attribute(tag, 'android:name') === feature);
    add(feature, Boolean(tag) && attribute(tag, 'android:required') !== 'false', 'Required tablet feature.');
  }
  const autofocus = [...clean.matchAll(/<uses-feature\b[^>]*>/g)].map(match => match[0]).find(tag => attribute(tag, 'android:name') === 'android.hardware.camera.autofocus');
  add('fixed-focus cameras allowed', Boolean(autofocus) && attribute(autofocus, 'android:required') === 'false', 'Autofocus must not be required.');
  return checks;
}

async function existing(file) { try { await access(file); return true; } catch { return false; } }
async function sdkTool(name) {
  const override = process.env[name === 'apksigner' ? 'APK_SIGNER' : 'APK_ANALYZER'];
  if (override) return override;
  const defaultSdk = process.platform === 'darwin' ? join(homedir(), 'Library/Android/sdk') : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || homedir(), 'Android/Sdk') : join(homedir(), 'Android/Sdk');
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk;
  const suffix = process.platform === 'win32' ? '.bat' : '';
  if (name === 'apkanalyzer') {
    for (const directory of ['cmdline-tools/latest/bin', 'tools/bin']) {
      const tool = join(sdk, directory, name + suffix); if (await existing(tool)) return tool;
    }
  } else {
    const versions = await readdir(join(sdk, 'build-tools')).catch(() => []);
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const tool = join(sdk, 'build-tools', version, name + suffix); if (await existing(tool)) return tool;
    }
  }
  return name + suffix;
}

function runTool(tool, args) {
  let command = tool, parameters = args;
  if (process.platform === 'win32') {
    // Android SDK wrappers are .bat files. Reject shell metacharacters rather
    // than interpolate an untrusted APK path into a command processor.
    if ([tool, ...args].some(value => /["%!\r\n^&|<>]/.test(value))) throw new Error('Use an APK/SDK path without shell metacharacters, or run the SDK commands manually.');
    command = process.env.ComSpec || 'cmd.exe';
    parameters = ['/d', '/v:off', '/s', '/c', '"' + [tool, ...args].map(value => `"${value}"`).join(' ') + '"'];
  }
  const result = spawnSync(command, parameters, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000, windowsHide: true });
  if (result.error) throw new Error(`${basename(tool)} could not run. Install JDK 21 / Android SDK command-line and build tools, or set APK_ANALYZER / APK_SIGNER. ${result.error.code || ''}`);
  if (result.status !== 0) throw new Error(`${basename(tool)} failed: ${(result.stderr || result.stdout).trim().slice(0, 700)}`);
  return result.stdout;
}

async function checkApk(file) {
  if (!/\.apk$/i.test(file) || !(await stat(file)).isFile()) throw new Error('Provide a real release .apk file. Do not provide a keystore or signing password.');
  const metadata = JSON.parse(await readFile('submission/amazon/submission.json', 'utf8'));
  const sha = createHash('sha256'); for await (const chunk of createReadStream(file)) sha.update(chunk);
  const report = { checkedAt: new Date().toISOString(), apkFile: basename(file), apkSha256: sha.digest('hex'), passed: false, checks: [], limitation: 'Static original-APK preflight only. This does not execute the APK, certify Fire hardware or verify Amazon-processed code.' };
  const add = (name, ok, detail) => report.checks.push({ name, ok, detail });
  try {
    const analyzer = await sdkTool('apkanalyzer'), signer = await sdkTool('apksigner');
    const signature = runTool(signer, ['verify', '--verbose', '--print-certs', file]);
    add('APK signing v2+', /Verified using v[234](?:\.\d+)? scheme[^\n]*:\s*true/i.test(signature), 'Requires successful apksigner verification and v2 or higher.');
    add('not a default debug certificate', !/CN\s*=\s*Android Debug/i.test(signature), 'A default Android debug certificate is not a release key.');
    report.signerCertificateSha256 = signature.match(/certificate SHA-256 digest:\s*(\S+)/i)?.[1] || null;
    report.checks.push(...inspectManifest(runTool(analyzer, ['manifest', 'print', file]), metadata.app));
    const fileList = runTool(analyzer, ['files', 'list', file]);
    const paths = fileList.split(/\r?\n/).map(path => path.trim().replace(/^\//, ''));
    for (const entry of ['assets/public/index.html', 'assets/public/privacy.html', 'assets/public/privacy-release.json', 'assets/capacitor.config.json']) add(entry, paths.includes(entry), 'Required bundled file.');
    const cat = path => runTool(analyzer, ['files', 'cat', '--file', '/' + path, file]);
    const cap = JSON.parse(cat('assets/capacitor.config.json'));
    add('offline native origin', !cap.server?.url && cap.server?.hostname === 'localhost' && cap.server?.androidScheme === 'https' && !cap.server?.allowNavigation?.length, 'No live server; same secure local origin.');
    add('WebView/release configuration', cap.android?.minWebViewVersion === 111 && cap.android?.webContentsDebuggingEnabled === false && cap.android?.allowMixedContent === false, 'Chromium 111 floor, no mixed content or explicit web debugging.');
    const bundled = JSON.parse(cat('assets/public/privacy-release.json'));
    const sourceHash = createHash('sha256').update(await readFile('config/publisher.json')).update('\0').update(await readFile('config/privacy-policy.json')).digest('hex');
    report.sourcePrivacySha256 = sourceHash;
    add('approved current privacy policy', bundled.ready === true && bundled.sourceSha256 === sourceHash, 'Reject a stale APK or a draft publisher policy.');
    const dex = runTool(analyzer, ['dex', 'packages', '--defined-only', file]);
    for (const plugin of ['CameraAccessPlugin', 'PdfSavePlugin', 'FilesystemPlugin', 'SharePlugin']) add(plugin, dex.includes(plugin), 'Required native implementation must be packaged.');
    add('no Google/billing/DRM SDKs in original APK', !/com\.google\.(?:android\.gms|firebase)|com\.android\.billingclient|com\.amazon\.device\.(?:iap|drm)/.test(dex), 'Amazon-processed binaries require a separate wrapper/privacy review.');
    const abis = [...new Set(paths.filter(path => /^lib\/[^/]+\/.*\.so$/.test(path)).map(path => path.split('/')[1]))];
    add('Fire ABI coverage', !abis.length || (abis.includes('armeabi-v7a') && abis.includes('arm64-v8a')), abis.length ? abis.join(', ') : 'No packaged native .so libraries; ABI-neutral app bytecode.');
  } catch (error) { add('inspection completed', false, error.message); }
  report.passed = report.checks.length > 0 && report.checks.every(check => check.ok);
  await mkdir('submission/amazon', { recursive: true });
  await writeFile('submission/amazon/apk-report.json', JSON.stringify(report, null, 2) + '\n');
  for (const check of report.checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  console.log(`APK SHA-256: ${report.apkSha256}\nReport: submission/amazon/apk-report.json`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const file = process.argv[2];
  if (!file || file === '--help') {
    console.log('Usage: npm run amazon:apk-check -- /path/to/signed-release.apk\nRequires local JDK/Android SDK apkanalyzer and apksigner. No APK is uploaded or executed; no signing secrets are requested.');
    if (!file) process.exitCode = 1;
  } else {
    try { await checkApk(resolve(file)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
