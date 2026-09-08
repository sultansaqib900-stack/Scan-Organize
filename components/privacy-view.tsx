'use client';

import { X } from 'lucide-react';
import publisher from '@/config/publisher.json';
import policy from '@/config/privacy-policy.json';
import { publisherIssues, renderPrivacySections } from '@/lib/publisher.mjs';
import { Button, IconButton, Modal } from './ui';

export function PrivacyView({ onClose }: { onClose: () => void }) {
  const issues = publisherIssues(publisher);
  const sections = renderPrivacySections(policy, publisher);
  return <Modal title="Privacy & support" onClose={onClose} className="privacy-dialog">
    <div className="privacy-content">
      <div className="privacy-header"><h2>Privacy &amp; support</h2><IconButton aria-label="Close privacy information" onClick={onClose} autoFocus><X size={20} /></IconButton></div>
      <p className="privacy-intro">How Scan & Organize handles your documents. This information is bundled with the app and can be read offline.</p>
      {issues.length > 0 && <p className="privacy-draft" role="status"><strong>Draft — not ready for submission.</strong> The publisher must complete and approve the public contact and policy details before building a release.</p>}
      {sections.map(section => <section key={section.title} aria-label={section.title}><h3>{section.title}</h3>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <Button variant="secondary" onClick={onClose}>Back to library</Button>
    </div>
  </Modal>;
}
