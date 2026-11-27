import { sha256Text } from './digest';
import { entryHash, Issue, LedgerEntry, LedgerPageDigest, VerifyResult, verdictLabel, receiptId } from './ledger';
import { Capacitor } from '@capacitor/core';
import { deliverBlob, pdfFilename } from './pdf';
import { writeExportToCache } from './native-pdf';

/**
 * A custody receipt is a small JSON file plus a human-readable PDF of the same
 * facts. The JSON is self-verifying: anyone holding it can re-link the hash chain
 * and re-check every recorded digest without access to the device that issued it.
 *
 * It is not a signature. It proves the recorded events are internally consistent
 * and that they descend from the stated starting point; it does not prove who
 * issued it. That is why the chain *head* matters: compare it with a copy taken
 * yesterday and a rewrite today is visible.
 */

export const RECEIPT_FORMAT = 'scan-organize-custody-receipt';
export const RECEIPT_VERSION = 1;

export interface ReceiptDocument {
  id: string;
  name: string;
  folder: string;
  pageCount: number;
  pages: LedgerPageDigest[];
  /** Latest recorded event for this document. */
  lastAction: string;
  /** Human-readable outcome of the vault check for this document. */
  state: 'verified' | 'issues' | 'untracked';
}

export interface ReceiptBody {
  format: typeof RECEIPT_FORMAT;
  version: number;
  issuedAt: string;
  app: { name: string; version: string };
  chain: {
    base: { seq: number; hash: string } | null;
    through: { seq: number; hash: string } | null;
    entries: LedgerEntry[];
  };
  documents: ReceiptDocument[];
  verdict: {
    ok: boolean;
    chain: VerifyResult['chain'];
    label: string;
    documentsChecked: number;
    pagesChecked: number;
    checkedBytes: number;
    trustedBytes: number;
    issues: number;
  };
}

export interface Receipt extends ReceiptBody {
  /** SHA-256 of the canonical body, so a mangled receipt file is detectable. */
  integrity: { self: string };
}

/** Deterministic JSON: same facts always produce the same digest. */
export function canonicalBody(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalBody).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalBody(record[key])}`).join(',')}}`;
}

export async function selfDigest(body: ReceiptBody): Promise<string> {
  // `version` and `format` are included: a silently downgraded format is a change.
  return sha256Text(canonicalBody(body));
}

export interface BuildReceiptInput {
  ledger: LedgerEntry[];
  documents: Array<{ id: string; name: string; folderId: string; pageIds: string[] }>;
  folderNames: Map<string, string>;
  result: VerifyResult;
  base: { seq: number; hash: string } | null;
  appVersion: string;
  issuedAt?: string;
}

export async function buildReceipt(input: BuildReceiptInput): Promise<Receipt> {
  const latest = new Map<string, LedgerEntry>();
  for (const entry of input.ledger) latest.set(entry.documentId, entry);
  const failing = new Set(input.result.issues.map(issue => issue.documentId).filter(Boolean));

  const documents: ReceiptDocument[] = input.documents.map(doc => {
    const entry = latest.get(doc.id);
    return {
      id: doc.id,
      name: doc.name,
      folder: input.folderNames.get(doc.folderId) ?? doc.folderId,
      pageCount: doc.pageIds.length,
      pages: entry && entry.action !== 'delete' ? entry.pages : doc.pageIds.map(id => ({ id, sha256: '' })),
      lastAction: entry?.action ?? 'untracked',
      state: failing.has(doc.id) ? 'issues' : entry ? 'verified' : 'untracked',
    };
  });

  const body: ReceiptBody = {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    app: { name: 'Scan & Organize', version: input.appVersion },
    chain: {
      base: input.base,
      through: input.result.head,
      entries: input.ledger,
    },
    documents,
    verdict: {
      ok: input.result.ok,
      chain: input.result.chain,
      label: verdictLabel(input.result),
      documentsChecked: input.result.documents,
      pagesChecked: input.result.pages,
      checkedBytes: input.result.checkedBytes,
      trustedBytes: input.result.trustedBytes,
      issues: input.result.issues.length,
    },
  };
  return { ...body, integrity: { self: await selfDigest(body) } };
}

/* ---------------------------------------------------------------------------
 * Checking a receipt someone hands you
 * ------------------------------------------------------------------------- */

export type ReceiptIssueKind =
  | 'not-a-receipt' | 'unsupported-version' | 'edited'
  | 'chain-gap' | 'chain-link' | 'chain-entry-hash' | 'chain-head'
  | 'verdict-claims-issues';

export interface ReceiptCheck {
  ok: boolean;
  issuedAt: string | null;
  head: { seq: number; hash: string } | null;
  entries: number;
  documents: number;
  pages: number;
  issues: Array<{ kind: ReceiptIssueKind; detail: string }>;
}

/**
 * Re-derives everything in a receipt from the receipt alone. No device, no
 * network, no trust in the file's own claims.
 */
export async function verifyReceipt(value: unknown): Promise<ReceiptCheck> {
  const check: ReceiptCheck = { ok: false, issuedAt: null, head: null, entries: 0, documents: 0, pages: 0, issues: [] };
  const fail = (kind: ReceiptIssueKind, detail: string) => { check.issues.push({ kind, detail }); };

  if (!value || typeof value !== 'object') { fail('not-a-receipt', 'This file is not a custody receipt.'); return check; }
  const receipt = value as Partial<Receipt>;
  if (receipt.format !== RECEIPT_FORMAT) { fail('not-a-receipt', 'This file is not a Scan & Organize custody receipt.'); return check; }
  if (receipt.version !== RECEIPT_VERSION) { fail('unsupported-version', `This receipt was made by a newer or older version (format ${String(receipt.version)}). Open it in a matching app version.`); return check; }
  if (!receipt.chain || !Array.isArray(receipt.chain.entries)) { fail('not-a-receipt', 'The receipt has no chain to check.'); return check; }

  // `version` stays inside the digested body: a silently downgraded format is a change.
  const { integrity, ...body } = receipt as Receipt;
  const recomputedBody = await selfDigest(body as ReceiptBody);
  if (integrity?.self !== recomputedBody) {
    fail('edited', 'The receipt file was changed after it was issued: its own digest no longer matches its contents.');
  }

  const base = receipt.chain.base ?? null;
  const through = receipt.chain.through ?? null;
  let previous = base?.hash ?? null;
  let seq = base?.seq ?? 0;
  for (const entry of receipt.chain.entries) {
    if (entry.seq !== seq + 1) fail('chain-gap', `Entry #${entry.seq} does not follow #${seq}.`);
    if (entry.previousHash !== previous) fail('chain-link', `Entry #${entry.seq} does not link to the entry before it.`);
    if (await entryHash(entry) !== entry.hash) fail('chain-entry-hash', `Entry #${entry.seq} (“${entry.name}”) was altered after it was written.`);
    previous = entry.hash;
    seq = entry.seq;
  }
  if (through) {
    if (through.seq !== seq || through.hash !== previous) {
      fail('chain-head', `The receipt claims to be current through #${through.seq}, but its chain ends at #${seq}. Entries are missing.`);
    }
  } else if (seq !== 0 || base) {
    fail('chain-head', 'The receipt has entries but names no chain head to check them against.');
  }
  if (receipt.verdict && receipt.verdict.ok === false) {
    fail('verdict-claims-issues', 'This receipt reports that problems were found when it was issued.');
  }

  check.issuedAt = typeof receipt.issuedAt === 'string' ? receipt.issuedAt : null;
  check.head = through;
  check.entries = receipt.chain.entries.length;
  check.documents = Array.isArray(receipt.documents) ? receipt.documents.length : 0;
  check.pages = Array.isArray(receipt.documents) ? receipt.documents.reduce((total, doc) => total + (doc.pages?.length ?? 0), 0) : 0;
  check.ok = check.issues.length === 0;
  return check;
}

/* ---------------------------------------------------------------------------
 * Human-readable receipt
 * ------------------------------------------------------------------------- */

const MAX_ISSUES_IN_RECEIPT = 25;

export function receiptFileName(issuedAt: string, name = 'Custody receipt'): string {
  return pdfFilename(`${name} ${issuedAt.slice(0, 10)}`);
}

export async function buildReceiptPdf(receipt: Receipt, issues: Issue[] = []): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  pdf.setProperties({ title: `Custody receipt ${receiptId(receipt.chain.through)}`, creator: 'Scan & Organize', subject: 'On-device document integrity receipt' });

  const ensure = (needed: number) => {
    if (y + needed <= pageHeight - margin) return;
    pdf.addPage('a4', 'portrait');
    y = margin;
  };
  const text = (value: string, size: number, style: 'normal' | 'bold' = 'normal', color = [38, 60, 46]) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(value, contentWidth) as string[];
    const lineHeight = size * 0.42;
    for (const line of lines) {
      ensure(lineHeight);
      pdf.setTextColor(color[0], color[1], color[2]);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };
  const rule = () => {
    ensure(4);
    pdf.setDrawColor(226, 231, 220);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
  };
  const gap = (size = 4) => { y += size; };

  text('Custody receipt', 20, 'bold');
  gap(1);
  text('Scan & Organize — on-device document integrity', 9, 'normal', [100, 115, 95]);
  gap(2);
  rule();

  const rows: Array<[string, string]> = [
    ['Receipt', receiptId(receipt.chain.through)],
    ['Issued', receipt.issuedAt.replace('T', ' ').slice(0, 19) + ' (device local time)'],
    ['Verdict', receipt.verdict.label],
    ['Documents', String(receipt.verdict.documentsChecked)],
    ['Pages covered', String(receipt.verdict.pagesChecked)],
    ['Ledger entries', String(receipt.chain.entries.length)],
    ['Bytes re-hashed', `${(receipt.verdict.checkedBytes / 1048576).toFixed(2)} MB`],
  ];
  for (const [label, value] of rows) {
    ensure(5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110, 122, 104);
    pdf.text(label, margin, y);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(38, 60, 46);
    pdf.text(value, margin + 42, y);
    y += 5;
  }
  if (receipt.verdict.trustedBytes > 0) {
    text(`A further ${(receipt.verdict.trustedBytes / 1048576).toFixed(2)} MB matched a previously recorded digest and was not re-read in this pass.`, 8, 'normal', [120, 130, 112]);
  }
  gap(3);
  rule();

  text('Chain', 12, 'bold');
  gap(1);
  text(receipt.chain.base ? `Continues from entry #${receipt.chain.base.seq} (${receipt.chain.base.hash.slice(0, 16)}…), recorded by an earlier device.` : 'Starts at the first entry recorded on this device.', 8, 'normal', [90, 104, 84]);
  gap(1);
  text(`Head: #${receipt.chain.through?.seq ?? 0} · ${receipt.chain.through?.hash ?? '—'}`, 8, 'normal', [38, 60, 46]);
  gap(4);
  rule();

  text('Documents', 12, 'bold');
  gap(1);
  for (const doc of receipt.documents) {
    ensure(14);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(38, 60, 46);
    pdf.text(pdf.splitTextToSize(doc.name, contentWidth - 55)[0] as string, margin, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110, 122, 104);
    pdf.text(`${doc.folder} · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · ${doc.state}`, margin + 55, y);
    y += 4;
    pdf.setFont('courier', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(120, 132, 112);
    for (const page of doc.pages.slice(0, 4)) {
      ensure(3.4);
      pdf.text(page.sha256 || '(no digest recorded)', margin + 3, y);
      y += 3.4;
    }
    if (doc.pages.length > 4) {
      ensure(3.4);
      pdf.text(`… ${doc.pages.length - 4} more page digest(s) in the JSON receipt`, margin + 3, y);
      y += 3.4;
    }
    gap(2);
  }
  if (!receipt.documents.length) text('No documents were stored when this receipt was issued.', 9, 'normal', [110, 122, 104]);

  if (issues.length) {
    gap(2); rule();
    text('Issues found', 12, 'bold');
    gap(1);
    for (const issue of issues.slice(0, MAX_ISSUES_IN_RECEIPT)) {
      text(`• ${issue.label} — ${issue.detail ?? issue.kind}${issue.expected ? ` (recorded ${issue.expected.slice(0, 16)}…, found ${(issue.found ?? '').slice(0, 16)}…)` : ''}`, 8, 'normal', [156, 87, 68]);
    }
    if (issues.length > MAX_ISSUES_IN_RECEIPT) text(`… and ${issues.length - MAX_ISSUES_IN_RECEIPT} more, listed in the app.`, 8, 'normal', [156, 87, 68]);
  }

  gap(2); rule();
  text('How to check this receipt', 10, 'bold');
  gap(1);
  text('Open Scan & Organize → Verify vault → Check a receipt, and choose the matching .json check file (saved alongside this PDF from the same screen). The app re-computes every digest and re-links the whole chain offline. Nothing is uploaded. Keep a copy somewhere other than the tablet: comparing an older receipt with a newer one is what makes a rewound ledger visible.', 8, 'normal', [90, 104, 84]);
  gap(2);
  text('This receipt records what the app measured and hashed on the device. It is not a signature or a legal certification, and it cannot prove who issued it — only that the recorded events are internally consistent and descend from the stated starting point.', 7.5, 'normal', [130, 140, 122]);

  pdf.setFont('courier', 'normal'); pdf.setFontSize(6); pdf.setTextColor(150, 158, 142);
  ensure(6);
  pdf.text(`receipt digest ${receipt.integrity.self}`, margin, y);

  return pdf.output('blob');
}

/** Builds and delivers a receipt PDF through the same native/browser path as documents. */
export async function exportReceipt(receipt: Receipt, issues: Issue[] = []): Promise<Awaited<ReturnType<typeof deliverBlob>>> {
  const blob = await buildReceiptPdf(receipt, issues);
  return deliverBlob(blob, receiptFileName(receipt.issuedAt), `Custody receipt ${receiptId(receipt.chain.through)}`);
}

export function receiptJsonFileName(issuedAt: string): string {
  return pdfFilename(`Custody receipt ${issuedAt.slice(0, 10)}`).replace(/\.pdf$/i, '.json');
}

export type JsonExportResult = 'native' | 'downloaded' | 'cancelled';

/**
 * Delivers the machine-checkable half of the receipt.
 *
 * The native file picker only accepts PDFs by design (it validates the file
 * name), so the JSON takes the share path on Android: one file, no storage
 * permission, and the user chooses where it lands.
 */
export async function exportReceiptJson(receipt: Receipt): Promise<JsonExportResult> {
  const fileName = receiptJsonFileName(receipt.issuedAt);
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) {
      throw new Error('Saving the check file needs the native file bridge. Rebuild the Fire tablet app with npm run amazon:sync.');
    }
    const uri = await writeExportToCache(blob, fileName);
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title: `Custody receipt ${receiptId(receipt.chain.through)}`, files: [uri], dialogTitle: 'Save check file' });
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return 'cancelled';
      throw error;
    }
    return 'native';
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
