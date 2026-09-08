import { describe, expect, it } from 'vitest';
import { inspectManifest } from '../../scripts/check-apk.mjs';
import { submissionFieldIssues, supportedScreenshotSize } from '../../scripts/check-submission.mjs';

const app = { packageName: 'app.scanandorganize.documents', versionName: '1.0', versionCode: 1, minSdk: 28, targetSdk: 36 };
const xml = `<manifest package="${app.packageName}" android:versionName="1.0" android:versionCode="1">
<uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-feature android:name="android.hardware.touchscreen" android:required="true"/>
<uses-feature android:name="android.hardware.camera.any" android:required="true"/>
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false"/>
<application android:debuggable="false" android:allowBackup="false" android:fullBackupContent="false"/>
</manifest>`;
const publisher = { publisherName: 'Test Publisher', supportEmail: 'support@sample-publisher.org', privacyPolicyUrl: 'https://sample-publisher.org/privacy', effectiveDate: '2026-09-08', policyApproved: true };

describe('submission preparation, not store certification', () => {
  it('validates expected fields from decoded APK manifest output', () => {
    expect(inspectManifest(xml, app).every(check => check.ok)).toBe(true);
  });
  it('rejects debuggable, wrong-package or broad-permission APK manifest output', () => {
    for (const invalid of [xml.replace('android:debuggable="false"', 'android:debuggable="true"'), xml.replace(app.packageName, 'different.package'), xml.replace('</manifest>', '<uses-permission android:name="android.permission.INTERNET"/></manifest>')]) {
      expect(inspectManifest(invalid, app).some(check => !check.ok)).toBe(true);
    }
  });
  it('accepts only documented screenshot dimensions, including portrait rotations', () => {
    expect(supportedScreenshotSize(800, 1280)).toBe(true);
    expect(supportedScreenshotSize(1920, 1200)).toBe(true);
    expect(supportedScreenshotSize(1280, 900)).toBe(false);
  });
  it('does not mark unchosen paid pricing or unperformed review steps as ready', () => {
    const metadata = { monetization: { model: 'paid-upfront', basePrice: null, currency: null, inAppPurchases: false, subscriptions: false, advertisingSdk: false, automaticDrm: 'No' }, publication: {} };
    const issues = submissionFieldIssues(metadata, publisher);
    expect(issues).toContain('Choose the one-time base price; do not leave the console on Free.');
    expect(issues.some(issue => issue.includes('Fire devices'))).toBe(true);
  });
  it('keeps Amazon-processed testing as an additional go-live gate, not a pre-upload loop', () => {
    const metadata = { monetization: { model: 'paid-upfront', basePrice: 2.99, currency: 'USD', inAppPurchases: false, subscriptions: false, advertisingSdk: false, automaticDrm: 'No', paidSettingConfirmedInConsole: true }, publication: { countries: ['US'], publisherAccountPaymentTaxSetupComplete: true, contentRatingQuestionnaireReviewed: true, privacyQuestionnaireReviewed: true, publicPrivacyUrlChecked: true, fireDeviceTestsPassed: true, amazonProcessedBuildTested: false } };
    expect(submissionFieldIssues(metadata, publisher)).toEqual([]);
    expect(submissionFieldIssues(metadata, publisher, true)).toHaveLength(1);
  });
});
