import { readFile } from 'node:fs/promises';
import { publisherIssues } from '../lib/publisher.mjs';

const issues = publisherIssues(JSON.parse(await readFile('config/publisher.json', 'utf8')));
if (issues.length) {
  console.error('Release blocked: complete config/publisher.json.\n' + issues.map(issue => `- ${issue}`).join('\n'));
  console.error('Do not invent publisher details or publish the draft policy. No account passwords or signing keys are needed in this file.');
  process.exitCode = 1;
} else {
  console.log('Publisher fields approved. Also verify that the public policy URL loads without login and matches the bundled policy.');
}
