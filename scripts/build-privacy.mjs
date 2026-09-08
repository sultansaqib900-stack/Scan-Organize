import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { publisherIssues, renderPrivacySections } from '../lib/publisher.mjs';

const publisherSource = await readFile('config/publisher.json');
const policySource = await readFile('config/privacy-policy.json');
const publisher = JSON.parse(publisherSource.toString());
const policy = JSON.parse(policySource.toString());
const issues = publisherIssues(publisher);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const sections = renderPrivacySections(policy, publisher);
const sourceSha256 = createHash('sha256').update(publisherSource).update('\0').update(policySource).digest('hex');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Scan &amp; Organize — Privacy policy</title>${issues.length ? '<meta name="robots" content="noindex,nofollow">' : ''}<style>body{margin:0;background:#f8f9f5;color:#263c2e;font:1rem/1.75 system-ui,sans-serif}main{max-width:48rem;margin:auto;padding:3rem clamp(1.2rem,5vw,3rem)}h1{font-size:2rem;line-height:1.2}h2{font-size:1.15rem;margin-top:2rem}p{color:#465445}aside{padding:1rem;border:1px solid #d4b862;background:#fff3d4;border-radius:.5rem}footer{border-top:1px solid #d7dfd2;margin-top:2rem;padding-top:1rem;font-size:.85rem}a{color:#315d3c}</style></head><body><main><h1>Scan &amp; Organize</h1><p>Privacy policy · ${escape(publisher.effectiveDate || 'Effective date pending')}</p>${issues.length ? '<aside><strong>Draft — do not publish.</strong><p>Publisher identity, contact information, policy URL and approval must be completed before submission.</p></aside>' : ''}${sections.map(section => `<section><h2>${escape(section.title)}</h2>${section.paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}</section>`).join('')}<footer>Amazon platform information: <a href="https://developer.amazon.com/docs/app-submission/understanding-submission.html">[1]</a>. This page contains no scripts, remote fonts, forms or tracking code. A hosting provider may process requests under its own practices.</footer></main></body></html>\n`;
await mkdir('public', { recursive: true });
await writeFile('public/privacy.html', html);
await writeFile('public/privacy-release.json', JSON.stringify({ schemaVersion: 1, publisher, sourceSha256, ready: issues.length === 0 }, null, 2) + '\n');
console.log(issues.length ? 'Bundled privacy policy generated as DRAFT. Release builds remain blocked until publisher details are approved.' : 'Approved publisher details and offline privacy policy generated.');
