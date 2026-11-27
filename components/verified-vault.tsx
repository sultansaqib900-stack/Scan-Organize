'use client';

import { AlertTriangle, Check, FileCheck2, FilePlus2, Fingerprint, LoaderCircle, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readableError } from '@/lib/model';
import { isAvailable } from '@/lib/digest';
import {
  DEFAULT_BUDGET_BYTES, Issue, receiptId, verifyVault, verdictLabel, VerifyResult,
} from '@/lib/ledger';
import { buildReceipt, exportReceipt, exportReceiptJson, Receipt, verifyReceipt, ReceiptCheck } from '@/lib/receipt';
import * as storage from '@/lib/storage';
import { Button, ConfirmDialog, ErrorMessage, Modal } from './ui';

const APP_VERSION = '1.0';

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function VerifiedVault({ onClose, notify }: { onClose: () => void; notify: (message: string) => void }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptCheck, setReceiptCheck] = useState<ReceiptCheck | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const [deep, setDeep] = useState(false);
  const [baseline, setBaseline] = useState<{ count: number } | null>(null);
  const [confirmBaseline, setConfirmBaseline] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'json' | null>(null);
  const [lastAudit, setLastAudit] = useState<{ head: { seq: number; hash: string } | null; at: string } | null>(null);
  const stop = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; stop.current = true; }, []);

  async function loadMarker() {
    const marker = await storage.readVaultMarker();
    if (alive.current) setLastAudit(marker.audited);
    return marker;
  }

  const check = useCallback(async (deepPass = false) => {
    if (!isAvailable()) { setError('Integrity checks need a secure context. Open the app over HTTPS, on localhost, or in the Fire tablet app.'); return; }
    setChecking(true); setError(''); setReceipt(null); setResult(null);
    stop.current = false;
    try {
      const marker = await loadMarker();
      const { snapshot } = await storage.readVault();
      const outcome = await verifyVault(
        { ...snapshot, base: marker.base },
        {
          budgetBytes: deepPass ? Number.POSITIVE_INFINITY : DEFAULT_BUDGET_BYTES,
          onProgress: (done, total) => { if (alive.current) setProgress({ done, total }); },
          shouldStop: () => stop.current || !alive.current,
        },
      );
      if (!alive.current) return;
      setResult(outcome); setIssues(outcome.issues);
      // Only a start-to-finish audit with no issues becomes the trusted point.
      if (!outcome.partial && outcome.ok && outcome.chain === 'audited') {
        await storage.markAudited(outcome.auditedThrough);
        await loadMarker();
      }
      // Documents saved before integrity tracking began have no entry yet.
      const latest = new Set(snapshot.ledger.map(entry => entry.documentId));
      const untracked = snapshot.documents.filter(doc => !latest.has(doc.id));
      setBaseline(untracked.length ? { count: untracked.length } : null);
    } catch (err) {
      if (alive.current) setError(readableError(err, 'The vault could not be checked. Your documents are unchanged.'));
    } finally {
      if (alive.current) setChecking(false);
    }
  }, []);

  // Run one check when the view opens; every later run is user-initiated.
  // The check reports progress through state, like the camera lifecycle effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void check(); }, [check]);

  async function recordBaselineForAll() {
    try {
      const { snapshot } = await storage.readVault();
      const latest = new Set(snapshot.ledger.map(entry => entry.documentId));
      const untracked = snapshot.documents.filter(doc => !latest.has(doc.id));
      const added = await storage.recordBaseline(untracked);
      setBaseline(null);
      notify(`${added} document${added === 1 ? '' : 's'} added to the ledger. Future changes are now provable.`);
      await check();
    } catch (err) { setError(readableError(err, 'The integrity baseline could not be recorded.')); }
  }

  async function currentReceipt() {
    if (!result) return null;
    if (receipt) return receipt;
    const { snapshot, folders, marker } = await storage.readVault();
    const built = await buildReceipt({
      ledger: snapshot.ledger,
      documents: snapshot.documents,
      folderNames: new Map(folders.map(folder => [folder.id, folder.name])),
      result,
      base: marker.base,
      appVersion: APP_VERSION,
    });
    setReceipt(built);
    return built;
  }

  async function exportPdf() {
    setExporting('pdf'); setError('');
    try {
      const built = await currentReceipt();
      if (!built) return;
      const outcome = await exportReceipt(built, issues);
      if (outcome === 'downloaded') notify('Custody receipt PDF saved — keep a copy off this tablet.');
      else if (outcome === 'saved') notify('Custody receipt saved to the location you chose.');
      else if (outcome === 'native') notify('Your custody receipt is ready in the native share sheet.');
      else if (outcome === 'shared') notify('Your custody receipt is ready to share.');
      else notify('Receipt export cancelled. You can create it again any time.');
    } catch (err) {
      setError(readableError(err, 'The receipt could not be exported. Your documents are unchanged.'));
    } finally { setExporting(null); }
  }

  async function exportJson() {
    setExporting('json'); setError('');
    try {
      const built = await currentReceipt();
      if (!built) return;
      const outcome = await exportReceiptJson(built);
      if (outcome === 'downloaded') notify('Check file saved — hand it over with the PDF so anyone can verify it.');
      else if (outcome === 'native') notify('Your check file is ready in the native share sheet.');
      else notify('Check-file export cancelled.');
    } catch (err) {
      setError(readableError(err, 'The check file could not be exported. Your documents are unchanged.'));
    } finally { setExporting(null); }
  }

  async function checkReceiptFile(file: File) {
    setReceiptError(''); setReceiptCheck(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('This file is too large to be a custody receipt.');
      const parsed = JSON.parse(await file.text()) as unknown;
      setReceiptCheck(await verifyReceipt(parsed));
    } catch (err) {
      setReceiptError(readableError(err, 'This file is not a readable custody receipt. Choose the JSON file supplied with the PDF.'));
    }
  }

  const docs = result?.documents ?? 0;
  const label = result ? verdictLabel(result) : '';
  const busy = checking || exporting !== null;
  const failing = issues.length;

  return <Modal title="Verify vault" onClose={onClose} busy={busy} className="privacy-dialog verify-dialog">
    <div className="privacy-content verify-content">
      <div className="privacy-header">
        <h2>Verify vault</h2>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
      </div>
      <p className="privacy-intro">Every save, rename and delete is recorded in a hash-chained ledger, and each page has a SHA-256 of its stored bytes. Checking re-reads your documents and recomputes those digests entirely on this device.</p>

      <div className={`verify-status ${result ? (result.ok ? 'ok' : 'bad') : ''}`} role="status" aria-live="polite">
        <span className="verify-status-icon">{checking ? <LoaderCircle size={22} className="spin" /> : result ? (result.ok ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />) : <Fingerprint size={22} />}</span>
        <div>
          <strong>{checking ? 'Checking every document…' : result ? label : 'Not checked yet'}</strong>
          <span>
            {checking
              ? `${progress.done} of ${progress.total || docs} documents · stay in the app until this finishes`
              : result
                ? `${result.documents} document${result.documents === 1 ? '' : 's'} · ${result.pages} page${result.pages === 1 ? '' : 's'} · ${formatBytes(result.checkedBytes)} re-read${result.trustedBytes ? ` · ${formatBytes(result.trustedBytes)} matched a recorded digest and was not re-read` : ''}`
                : 'Nothing has been verified on this device yet.'}
          </span>
        </div>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {result && !checking && <>
        <dl className="verify-facts">
          <div><dt>Chain</dt><dd>{result.chain === 'audited' ? 'complete' : result.chain === 'partial' ? 'partial' : 'starting point'}</dd></div>
          <div><dt>Ledger entries</dt><dd>{result.entries}</dd></div>
          <div><dt>Healthy documents</dt><dd>{result.documentsHealthy}</dd></div>
          <div><dt>Needing attention</dt><dd>{result.documentsFailing}</dd></div>
          <div><dt>Chain head</dt><dd><code>{receiptId(result.head)}</code></dd></div>
          <div><dt>Last full audit</dt><dd>{lastAudit ? `${formatWhen(lastAudit.at)} · ${receiptId(lastAudit.head)}` : 'never'}</dd></div>
        </dl>

        {result.chain === 'not-audited' && result.ok && <p className="field-hint">This chain begins here rather than at the first entry ever recorded. Later checks prove nothing was changed since now, but cannot speak for earlier history.</p>}

        {failing > 0 && <div className="verify-issues">
          <h3><AlertTriangle size={16} /> What needs attention</h3>
          {issues.slice(0, 40).map((issue, index) => <div className="verify-issue" key={`${issue.kind}-${issue.documentId ?? issue.pageId ?? index}`}>
            <strong>{issue.label}</strong>
            <span>{issue.detail}</span>
            {issue.expected && <code>recorded {issue.expected.slice(0, 20)}… {issue.found ? `· found ${issue.found.slice(0, 20)}…` : ''}</code>}
          </div>)}
          <p className="field-hint">Nothing is deleted or repaired automatically. If a page is unreadable, open the document and export it now while the rest is intact.</p>
        </div>}

        {baseline && <div className="verify-baseline">
          <h3><FilePlus2 size={16} /> {baseline.count} document{baseline.count === 1 ? '' : 's'} from before integrity tracking</h3>
          <p>These were saved by an earlier version, so there is no recorded digest to compare against yet. Recording a baseline now makes every future change provable.</p>
          <Button variant="secondary" onClick={() => setConfirmBaseline(true)}>Record baseline</Button>
        </div>}

        <div className="verify-actions">
          <Button variant="secondary" onClick={() => void check()} disabled={checking}>Check again</Button>
          <Button variant="secondary" onClick={() => { setDeep(true); void check(true); }} disabled={checking}>Deep check <span className="verify-hint">every byte</span></Button>
          <Button onClick={() => void exportPdf()} busy={exporting === 'pdf'} disabled={!result || busy}>{exporting !== 'pdf' && <FileCheck2 size={17} />}Receipt PDF</Button>
          <Button variant="secondary" onClick={() => void exportJson()} busy={exporting === 'json'} disabled={!result || busy}>{exporting !== 'json' && <FileCheck2 size={17} />}Check file</Button>
        </div>
        {deep && <p className="field-hint">Deep check re-reads every stored page no matter how large the library. It is slower and uses more memory.</p>}
        {receipt && <p className="field-hint">Receipt {receiptId(receipt.chain.through)} · digest <code>{receipt.integrity.self.slice(0, 16)}…</code> · save both files together: the PDF is for people, the check file is for checking.</p>}
      </>}

      <section aria-label="Check a receipt" className="verify-receipt">
        <h3><FileCheck2 size={16} /> Check a receipt</h3>
        <p>Choose the JSON file supplied with a custody receipt. It is checked here, offline, without touching your library.</p>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Choose a custody receipt file"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void checkReceiptFile(file); }}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()}><Upload size={16} />Choose receipt file</Button>
        {receiptError && <ErrorMessage>{receiptError}</ErrorMessage>}
        {receiptCheck && <div className={`verify-status ${receiptCheck.ok ? 'ok' : 'bad'}`} role="status">
          <span className="verify-status-icon">{receiptCheck.ok ? <Check size={22} /> : <AlertTriangle size={22} />}</span>
          <div>
            <strong>{receiptCheck.ok ? 'Receipt checks out' : 'Receipt does not check out'}</strong>
            <span>
              {receiptCheck.ok
                ? `Issued ${formatWhen(receiptCheck.issuedAt)} · ${receiptCheck.entries} ${receiptCheck.entries === 1 ? 'entry' : 'entries'} · ${receiptCheck.documents} ${receiptCheck.documents === 1 ? 'document' : 'documents'} · ${receiptCheck.pages} ${receiptCheck.pages === 1 ? 'page' : 'pages'} · head ${receiptId(receiptCheck.head)}`
                : receiptCheck.issues[0]?.detail}
            </span>
          </div>
        </div>}
        {receiptCheck && !receiptCheck.ok && receiptCheck.issues.slice(1).map((issue, index) => <div className="verify-issue" key={`${issue.kind}-${index}`}><strong>{issue.kind.replace(/-/g, ' ')}</strong><span>{issue.detail}</span></div>)}
        {receiptCheck?.ok && <p className="field-hint">A valid receipt proves the recorded events are internally consistent and unchanged since they were written. It is not a signature: only comparing it with an earlier receipt shows that history was not rewritten.</p>}
      </section>

      <p className="field-hint verify-legal">Integrity data is stored with your documents on this device. A local attacker who can rewrite both the documents and the ledger is not detected by this check — keeping a receipt somewhere else is what closes that gap.</p>
    </div>
    {confirmBaseline && <ConfirmDialog
      title="Record an integrity baseline?"
      description={<>The current contents of {baseline?.count ?? 0} document{baseline?.count === 1 ? '' : 's'} will be added to the ledger as trusted starting points. Anything already altered before now is not detected — this only makes <strong>future</strong> changes provable.</>}
      confirmLabel="Record baseline"
      onClose={() => setConfirmBaseline(false)}
      onConfirm={recordBaselineForAll}
    />}
  </Modal>;
}
