/**
 * @typedef {{publisherName: string, supportEmail: string, privacyPolicyUrl: string, effectiveDate: string, policyApproved: boolean}} Publisher
 * @typedef {{title: string, paragraphs: string[]}} PrivacySection
 */
/** Pure validation shared by the offline UI and release tooling; no network.
 * @param {Partial<Publisher>} value
 * @returns {string[]}
 */
export function publisherIssues(value) {
  const issues = [];
  const text = key => typeof value?.[key] === 'string' ? value[key].trim() : '';
  const name = text('publisherName');
  if (!name || /\[|\]|your (?:name|company)|publisher name|todo/i.test(name)) issues.push('Set the real public publisherName.');
  const email = text('supportEmail');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@(?:example\.(?:com|org|net)|invalid|localhost)$/i.test(email)) issues.push('Set a real public supportEmail (not an example address).');
  try {
    const url = new URL(text('privacyPolicyUrl'));
    if (url.protocol !== 'https:' || url.username || url.password || /^(?:localhost|127\.0\.0\.1|example\.(?:com|org|net))$/i.test(url.hostname)) throw new Error('Not a public policy URL');
  } catch { issues.push('Set the public HTTPS privacyPolicyUrl.'); }
  const date = text('effectiveDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) issues.push('Set a valid effectiveDate (YYYY-MM-DD).');
  if (value?.policyApproved !== true) issues.push('Review the policy, then set policyApproved to true.');
  return issues;
}

/** @param {{sections: PrivacySection[]}} policy
 * @param {Publisher} publisher
 * @returns {PrivacySection[]}
 */
export function renderPrivacySections(policy, publisher) {
  const substitutions = {
    publisherName: publisher.publisherName || '[publisher name pending]',
    supportEmail: publisher.supportEmail || '[support email pending]',
    privacyPolicyUrl: publisher.privacyPolicyUrl || '[public privacy-policy URL pending]',
    effectiveDate: publisher.effectiveDate || '[effective date pending]',
  };
  return policy.sections.map(section => ({
    title: section.title,
    paragraphs: section.paragraphs.map(paragraph => paragraph.replace(/\{\{(\w+)\}\}/g, (token, key) => substitutions[key] || token)),
  }));
}
