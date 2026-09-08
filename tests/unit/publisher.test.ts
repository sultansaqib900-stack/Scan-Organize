import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { publisherIssues, renderPrivacySections } from '@/lib/publisher.mjs';
import policy from '@/config/privacy-policy.json';

// Synthetic contact details are test inputs only, never production defaults.
const complete = { publisherName: 'Example Test Publisher', supportEmail: 'support@sample-publisher.org', privacyPolicyUrl: 'https://sample-publisher.org/privacy', effectiveDate: '2026-09-08', policyApproved: true };

describe('submission privacy safeguards', () => {
  it('blocks a release with missing publisher details or approval', () => {
    expect(publisherIssues({})).toHaveLength(5);
    expect(publisherIssues({ ...complete, policyApproved: false })).toContain('Review the policy, then set policyApproved to true.');
  });
  it('accepts complete, explicitly approved publisher fields', () => {
    expect(publisherIssues(complete)).toEqual([]);
  });
  it('rejects placeholder email, insecure/private example URLs and impossible dates', () => {
    expect(publisherIssues({ ...complete, supportEmail: 'you@example.com' })).not.toEqual([]);
    for (const privacyPolicyUrl of ['http://sample-publisher.org/privacy', 'https://localhost/privacy', 'https://example.com/privacy', 'https://user:password@sample-publisher.org/privacy']) {
      expect(publisherIssues({ ...complete, privacyPolicyUrl })).not.toEqual([]);
    }
    expect(publisherIssues({ ...complete, effectiveDate: '2026-02-31' })).not.toEqual([]);
  });
  it('renders the same policy content without template tokens once configured', () => {
    const sections = renderPrivacySections(policy, complete);
    const text = sections.flatMap(section => section.paragraphs).join('\n');
    expect(text).toContain(complete.publisherName); expect(text).toContain(complete.supportEmail);
    expect(text).not.toMatch(/\{\{|\[.*pending\]/);
    expect(text).toContain('one-time paid Appstore app');
    expect(text).toContain('Amazon documents');
  });
  it('uses visible pending markers instead of inventing a publisher', () => {
    const sections = renderPrivacySections(policy, { publisherName: '', supportEmail: '', privacyPolicyUrl: '', effectiveDate: '', policyApproved: false });
    expect(sections[0].paragraphs.join(' ')).toContain('[publisher name pending]');
  });
  it('declares release-task guards for draft or stale privacy assets (source check)', async () => {
    const gradle = await readFile('android/app/release-privacy.gradle', 'utf8');
    expect(gradle).toContain('preReleaseBuild'); expect(gradle).toContain('bundled.ready != true');
    expect(gradle).toContain('bundled.sourceSha256 != expectedHash');
    expect(await readFile('android/app/build.gradle', 'utf8')).toContain("apply from: 'release-privacy.gradle'");
  });
});
