import { blobDigest, sha256Text } from './digest';
import { ScanDocument, ScanPage } from './model';

/**
 * Hash-chained custody ledger for local-only documents.
 *
 * What this proves — and what it does not:
 *
 * - Every entry commits to the previous entry, so removing, reordering or editing
 *   any recorded event breaks the chain at a detectable point.
 * - Every entry commits to the SHA-256 of each page's stored bytes.
 * - Verification also re-hashes the *live* blobs, so silent corruption (bad flash,
 *   an interrupted write, an operating system or browser clearing data) is named
 *   per document and per page rather than discovered later by a user opening a
 *   document and finding a broken image.
 *
 * It is not a signature and not a defence against someone who can rewrite the
 * whole ledger: a local-only app has no external trust anchor. The originals are
 * what make a rewrite visible — keeping a receipt outside the device does.
 */

export interface LedgerPageDigest {
  id: string;
  sha256: string;
}

export type LedgerAction = 'create' | 'rename' | 'delete';

export interface LedgerEntry {
  /** Monotonic sequence number, 1 on the first entry. */
  seq: number;
  /** Durable identifier of the document, used to correlate create/rename/delete. */
  documentId: string;
  action: LedgerAction;
  /** Document name as recorded by this event. */
  name: string;
  /** Name before a rename, so the ledger tells the whole story. */
  previousName?: string;
  /** Folder placement at the time of the event. */
  folderId: string;
  pageCount: number;
  pages: LedgerPageDigest[];
  /** When the app recorded the event (ISO 8601). */
  at: string;
  /** Digest of the previous entry; null only for the first entry. */
  previousHash: string | null;
  /** SHA-256 of the canonical entry body, including previousHash. */
  hash: string;
}

export const LEDGER_VERSION = 1;

/** Deterministic JSON: key order is fixed by sorting, and undefined members never appear. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

export interface EntryBody {
  seq: number;
  documentId: string;
  action: LedgerAction;
  name: string;
  previousName?: string;
  folderId: string;
  pageCount: number;
  pages: LedgerPageDigest[];
  at: string;
  previousHash: string | null;
}

export function canonicalEntryBody(body: EntryBody): string {
  return canonical({
    version: LEDGER_VERSION,
    seq: body.seq,
    documentId: body.documentId,
    action: body.action,
    name: body.name,
    previousName: body.previousName,
    folderId: body.folderId,
    pageCount: body.pageCount,
    pages: body.pages,
    at: body.at,
    previousHash: body.previousHash,
  });
}

export async function entryHash(body: EntryBody): Promise<string> {
  return sha256Text(canonicalEntryBody(body));
}

/** The chain head is what a receipt pins: seq plus hash. */
export function chainHead(entries: LedgerEntry[]): { seq: number; hash: string } | null {
  const last = entries.at(-1);
  return last ? { seq: last.seq, hash: last.hash } : null;
}

export interface DraftLike {
  id: string;
  image: Blob;
  width: number;
  height: number;
}

export async function pageDigests(pages: Array<Pick<ScanPage, 'id' | 'image'> | DraftLike>): Promise<LedgerPageDigest[]> {
  return Promise.all(pages.map(async page => ({ id: page.id, sha256: await blobDigest(page.image) })));
}

/* ---------------------------------------------------------------------------
 * Verification
 * ------------------------------------------------------------------------- */

export type IssueKind =
  | 'vault-state-unreadable'
  | 'ledger-segment-missing'
  | 'ledger-tail-truncated'
  | 'ledger-leading-or-hash'
  | 'ledger-link-broken'
  | 'ledger-hash-mismatch'
  | 'document-missing'
  | 'document-untracked'
  | 'page-missing'
  | 'page-corrupt';

export interface Issue {
  kind: IssueKind;
  /** Human name to show; falls back to the id when the record is gone. */
  label: string;
  documentId?: string;
  pageId?: string;
  pageNumber?: number;
  seq?: number;
  expected?: string;
  found?: string;
  detail?: string;
}

export interface DocumentStatus {
  documentId: string;
  name: string;
  folderId: string;
  /** Last ledger event recorded for this document. */
  lastAction: LedgerAction;
  pageCount: number;
  ok: boolean;
}

/**
 * What storage hands to `verifyVault`. Deliberately plain data so the verdict can
 * be recomputed from an exported snapshot in a test, or after a restore.
 */
export interface VaultState {
  ledger: LedgerEntry[];
  documents: Array<Pick<ScanDocument, 'id' | 'name' | 'folderId' | 'pageIds' | 'createdAt'>>;
  /** Every stored page record, including any no document points at. */
  pages: Array<Pick<ScanPage, 'id' | 'documentId' | 'image' | 'width' | 'height'> & { sha256: string }>;
  folderIds: string[];
  /** Set when the ledger snapshot is a suffix of a longer chain (an export/restore boundary). */
  base?: { seq: number; hash: string } | null;
}

export interface VerifyOptions {
  /** Bytes actively re-hashed during verification. */
  budgetBytes?: number;
  /** Called after each document so the UI can show progress. */
  onProgress?: (checked: number, total: number) => void;
  /** Lets a long verification stop between documents. */
  shouldStop?: () => boolean;
}

export interface VerifyResult {
  ok: boolean;
  head: { seq: number; hash: string } | null;
  entries: number;
  documents: number;
  pages: number;
  /** Present on a start-to-finish audit; identifies the receipt this state matches. */
  chain: 'audited' | 'not-audited' | 'partial';
  auditedThrough: { seq: number; hash: string } | null;
  documentsHealthy: number;
  documentsFailing: number;
  corruptedPages: number;
  /** Bytes actually re-hashed in this run. */
  checkedBytes: number;
  /** Bytes that match a previously recorded digest and were not re-read. */
  trustedBytes: number;
  bytesInspected: number;
  /** True when the time budget stopped verification early. */
  partial: boolean;
  issues: Issue[];
}

export const DEFAULT_BUDGET_BYTES = 96 * 1024 * 1024;

export async function verifyVault(state: VaultState, options: VerifyOptions = {}): Promise<VerifyResult> {
  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const issues: Issue[] = [];
  const { ledger, documents, pages } = state;

  const result: VerifyResult = {
    ok: true, head: null, entries: ledger.length, documents: documents.length, pages: pages.length,
    chain: 'not-audited', auditedThrough: null, documentsHealthy: 0, documentsFailing: 0,
    corruptedPages: 0, checkedBytes: 0, trustedBytes: 0, bytesInspected: 0, partial: false, issues,
  };

  const pageById = new Map(pages.map(page => [page.id, page]));
  const documentIds = new Set(documents.map(doc => doc.id));

  /* 1. Chain over record hashes only — never reads page bytes. */
  const recent: Array<{ seq: number; hash: string }> = [];
  let lastHash = state.base?.hash ?? null;
  let lastSeq = state.base?.seq ?? 0;
  let firstEntry = true;
  for (const entry of ledger) {
    if (entry.seq !== lastSeq + 1) {
      issues.push({ kind: 'ledger-segment-missing', seq: entry.seq, label: `Ledger entry #${entry.seq}`, detail: `Expected #${lastSeq + 1}. Entries are missing from this device.` });
    }
    if (firstEntry && state.base === undefined && entry.previousHash !== null) {
      issues.push({ kind: 'ledger-leading-or-hash', seq: entry.seq, label: `Ledger entry #${entry.seq}`, detail: 'The first entry must not point at a previous entry.' });
    }
    if (entry.previousHash !== lastHash) {
      issues.push({ kind: 'ledger-link-broken', seq: entry.seq, label: `“${entry.name}” (#${entry.seq})`, expected: lastHash ?? 'no previous entry', found: entry.previousHash ?? 'no previous entry', detail: 'This entry does not follow the one before it.' });
    }
    const recomputed = await entryHash(entry);
    if (recomputed !== entry.hash) {
      issues.push({ kind: 'ledger-hash-mismatch', seq: entry.seq, label: `“${entry.name}” (#${entry.seq})`, expected: entry.hash, found: recomputed, detail: 'The recorded entry was changed after it was written.' });
    }
    lastHash = entry.hash;
    lastSeq = entry.seq;
    firstEntry = false;
    recent.push({ seq: entry.seq, hash: entry.hash });
  }
  result.head = lastSeq ? { seq: lastSeq, hash: lastHash as string } : null;

  /* 2. Completeness: never lets a deleted entry pass silently.
   * With no base we hold the whole chain, so it is audited from the beginning.
   * With a base (a restored snapshot) it is audited only if the first retained
   * entry actually links to that recorded point. */
  if (state.base) {
    if (!ledger.length || ledger[0].previousHash === state.base.hash) {
      result.chain = 'audited';
    } else {
      issues.push({ kind: 'ledger-leading-or-hash', seq: ledger[0].seq, label: `Ledger entry #${ledger[0].seq}`, expected: state.base.hash, found: ledger[0].previousHash ?? 'no previous entry', detail: 'The ledger does not continue from the audited point.' });
    }
  } else {
    result.chain = 'audited';
  }
  if (result.chain === 'audited') result.auditedThrough = result.head;

  /* 3. Per-document: latest ledger state versus what is actually stored. */
  const latest = new Map<string, LedgerEntry>();
  for (const entry of ledger) latest.set(entry.documentId, entry);

  for (const [documentId, entry] of latest) {
    if (entry.action !== 'delete' && !documentIds.has(documentId)) {
      issues.push({ kind: 'document-missing', documentId, label: `“${entry.name}”`, detail: 'The ledger records this document, but it is no longer on this device.' });
    }
  }
  for (const doc of documents) {
    const entry = latest.get(doc.id);
    if (!entry) {
      issues.push({ kind: 'document-untracked', documentId: doc.id, label: `“${doc.name}”`, detail: 'This document has no ledger entry, so its integrity cannot be vouched for.' });
    } else if (entry.action === 'delete') {
      issues.push({ kind: 'document-untracked', documentId: doc.id, label: `“${doc.name}”`, detail: 'The ledger says this document was deleted, but it is still stored.' });
    } else if (entry.pageCount !== doc.pageIds.length) {
      issues.push({ kind: 'document-untracked', documentId: doc.id, label: `“${doc.name}”`, detail: `The ledger records ${entry.pageCount} page(s); the document lists ${doc.pageIds.length}.` });
    }
  }
  // Folders are presentation metadata, not evidence: an empty folder needs no
  // coverage, and a folder is not something a digest can vouch for.

  /* 4. Per-page: hash live bytes inside a time budget. */
  const claimed = new Set<string>();
  const stopped = () => options.shouldStop?.() === true;
  for (let index = 0; index < documents.length; index++) {
    const doc = documents[index];
    const entry = latest.get(doc.id);
    const before = issues.length;
    if (entry && entry.action !== 'delete') {
      for (let position = 0; position < doc.pageIds.length; position++) {
        const pageId = doc.pageIds[position];
        claimed.add(pageId);
        const stored = pageById.get(pageId);
        if (!stored) {
          issues.push({ kind: 'page-missing', documentId: doc.id, pageId, pageNumber: position + 1, label: `“${doc.name}” page ${position + 1}`, detail: 'A page listed by this document is not stored.' });
          result.corruptedPages++;
          continue;
        }
        const recorded = entry.pages[position];
        if (!recorded || recorded.id !== pageId) {
          issues.push({ kind: 'page-corrupt', documentId: doc.id, pageId, pageNumber: position + 1, label: `“${doc.name}” page ${position + 1}`, detail: 'The page at this position is not the one the ledger recorded (added, removed or reordered).' });
          result.corruptedPages++;
          continue;
        }
        if (!stored.sha256 || !(stored.image instanceof Blob)) {
          issues.push({ kind: 'page-corrupt', documentId: doc.id, pageId, pageNumber: position + 1, label: `“${doc.name}” page ${position + 1}`, detail: 'This page is not a readable image. It cannot be opened or exported.' });
          result.corruptedPages++;
          continue;
        }
        if (stored.sha256 !== recorded.sha256) {
          issues.push({ kind: 'page-corrupt', documentId: doc.id, pageId, pageNumber: position + 1, label: `“${doc.name}” page ${position + 1}`, expected: recorded.sha256, found: stored.sha256, detail: 'The stored image no longer matches its recorded digest.' });
          result.corruptedPages++;
          continue;
        }
        // Digest matches. Re-read the bytes only while the budget allows, and
        // always finish the document in progress so the verdict is never partial
        // inside a document.
        if (result.checkedBytes < budget || issues.length > before) {
          const live = await blobDigest(stored.image);
          result.checkedBytes += stored.image.size;
          result.bytesInspected += stored.image.size;
          if (live !== recorded.sha256) {
            issues.push({ kind: 'page-corrupt', documentId: doc.id, pageId, pageNumber: position + 1, label: `“${doc.name}” page ${position + 1}`, expected: recorded.sha256, found: live, detail: 'The stored image bytes do not match the recorded digest.' });
            result.corruptedPages++;
          }
        } else {
          result.trustedBytes += stored.image.size;
          result.partial = true;
        }
      }
    }
    if (issues.length === before) result.documentsHealthy++; else result.documentsFailing++;
    options.onProgress?.(index + 1, documents.length);
    if (stopped()) { result.partial = true; break; }
  }

  for (const page of pages) {
    if (!claimed.has(page.id)) {
      issues.push({ kind: 'page-missing', pageId: page.id, label: `Untracked page ${page.id.slice(0, 8)}`, detail: 'A stored page is not listed by any document.' });
      result.corruptedPages++;
    }
  }

  result.ok = issues.length === 0;
  if (result.partial && result.chain === 'audited') result.chain = 'partial';
  return result;
}

/** Stable machine-readable label for the receipt and the UI. */
export function verdictLabel(result: Pick<VerifyResult, 'ok' | 'partial' | 'chain'>): string {
  if (!result.ok) return 'Issues found';
  if (result.partial) return 'Verified (partial)';
  if (result.chain === 'audited') return 'Verified';
  return 'Verified (starting point)';
}

export function receiptId(head: { seq: number; hash: string } | null): string {
  if (!head) return '—';
  return `${head.seq}-${head.hash.slice(0, 12).toUpperCase()}`;
}
