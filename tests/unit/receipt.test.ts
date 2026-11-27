import { describe, expect, it } from 'vitest';
import { buildReceipt, canonicalBody, Receipt, ReceiptBody, selfDigest, verifyReceipt } from '@/lib/receipt';
import { blobDigest } from '@/lib/digest';
import { entryHash, LedgerEntry, verifyVault, VaultState } from '@/lib/ledger';

/**
 * A fixture whose recorded digests are the real digests of the real page bytes,
 * so a failure means the verifier found a genuine problem rather than a lying
 * fixture.
 */
async function library(names: string[]) {
  const ledger: LedgerEntry[] = [];
  const documents: VaultState['documents'] = [];
  const pages: VaultState['pages'] = [];
  let previous: string | null = null;
  for (const [index, name] of names.entries()) {
    const image = new Blob([`bytes-${index + 1}`]);
    const sha256 = await blobDigest(image);
    const pageId = `page-${index + 1}`;
    const body = {
      seq: index + 1,
      documentId: `doc-${index + 1}`,
      action: 'create' as const,
      name,
      folderId: 'work',
      pageCount: 1,
      pages: [{ id: pageId, sha256 }],
      at: '2026-10-01T10:00:00.000Z',
      previousHash: previous,
    };
    const entry: LedgerEntry = { ...body, hash: await entryHash(body) };
    ledger.push(entry);
    documents.push({ id: entry.documentId, name, folderId: 'work', pageIds: [pageId], createdAt: entry.at });
    pages.push({ id: pageId, documentId: entry.documentId, image, width: 10, height: 10, sha256 });
    previous = entry.hash;
  }
  return { ledger, documents, pages, folderIds: ['unfiled', 'work'], base: null } satisfies VaultState;
}

async function issued() {
  const state = await library(['Document 1', 'Document 2', 'Document 3']);
  const result = await verifyVault(state);
  const receipt = await buildReceipt({
    ledger: state.ledger,
    documents: state.documents,
    folderNames: new Map([['work', 'Work']]),
    result,
    base: null,
    appVersion: '1.0',
    issuedAt: '2026-10-25T09:00:00.000Z',
  });
  return { state, result, receipt };
}

/** Removes the digest and re-adds it, so only the facts under test differ. */
async function resign(receipt: Receipt, change: (body: ReceiptBody) => ReceiptBody): Promise<Receipt> {
  const { integrity, ...body } = receipt;
  void integrity;
  const doctored = change(body);
  return { ...doctored, integrity: { self: await selfDigest(doctored) } };
}

describe('custody receipts', () => {
  it('is self-verifying: its own digest matches its contents', async () => {
    const { receipt } = await issued();
    const { integrity, ...body } = receipt;
    expect(integrity.self).toBe(await selfDigest(body));
    const check = await verifyReceipt(receipt);
    expect(check.issues).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.entries).toBe(3);
    expect(check.documents).toBe(3);
    expect(check.pages).toBe(3);
    expect(check.head).toEqual(receipt.chain.through);
  });

  it('describes each document, its folder name and its page digests', async () => {
    const { state, receipt } = await issued();
    expect(receipt.documents[0]).toMatchObject({ name: 'Document 1', folder: 'Work', pageCount: 1, state: 'verified', lastAction: 'create' });
    expect(receipt.documents[0].pages[0].sha256).toBe(state.pages[0].sha256);
    expect(receipt.verdict).toMatchObject({ ok: true, chain: 'audited', documentsChecked: 3, pagesChecked: 3 });
  });

  it('rejects a receipt whose contents were edited after issue', async () => {
    const { receipt } = await issued();
    const tampered: Receipt = { ...receipt, documents: receipt.documents.map((doc, index) => index ? doc : { ...doc, name: 'Something else' }) };
    const check = await verifyReceipt(tampered);
    expect(check.ok).toBe(false);
    expect(check.issues.some(issue => issue.kind === 'edited')).toBe(true);
  });

  it('rejects a re-issued receipt that quietly drops a ledger entry', async () => {
    const { receipt } = await issued();
    // Re-sign so only the chain is dishonest: the hard case.
    const doctored = await resign(receipt, body => ({ ...body, chain: { ...body.chain, entries: body.chain.entries.slice(0, 2) } }));
    const check = await verifyReceipt(doctored);
    expect(check.ok).toBe(false);
    expect(check.issues.some(issue => issue.kind === 'chain-head')).toBe(true);
  });

  it('rejects a re-signed receipt with a rewritten entry', async () => {
    const { receipt } = await issued();
    const entries = receipt.chain.entries;
    const doctored = await resign(receipt, body => ({ ...body, chain: { ...body.chain, entries: [entries[0], { ...entries[1], name: 'Forged name' }, entries[2]] } }));
    const check = await verifyReceipt(doctored);
    expect(check.ok).toBe(false);
    expect(check.issues.some(issue => issue.kind === 'chain-entry-hash')).toBe(true);
  });

  it('rejects a receipt that admits problems were found when it was issued', async () => {
    const { receipt } = await issued();
    const doctored = await resign(receipt, body => ({ ...body, verdict: { ...body.verdict, ok: false } }));
    const check = await verifyReceipt(doctored);
    expect(check.ok).toBe(false);
    expect(check.issues.some(issue => issue.kind === 'verdict-claims-issues')).toBe(true);
  });

  it('asks for a matching app version rather than guessing', async () => {
    expect((await verifyReceipt({ hello: 'world' })).issues[0].kind).toBe('not-a-receipt');
    const other = await verifyReceipt({ format: 'scan-organize-custody-receipt', version: 99 });
    expect(other.ok).toBe(false);
    expect(other.issues[0].kind).toBe('unsupported-version');
  });

  it('verifies a receipt issued from a restored snapshot that starts mid-chain', async () => {
    const full = await library(['One', 'Two', 'Three', 'Four']);
    const restored: VaultState = {
      ledger: full.ledger.slice(2),
      documents: full.documents.slice(2),
      pages: full.pages.slice(2),
      folderIds: full.folderIds,
      base: { seq: full.ledger[1].seq, hash: full.ledger[1].hash },
    };
    const result = await verifyVault(restored);
    expect(result.issues).toEqual([]);
    expect(result.chain).toBe('audited');
    const receipt = await buildReceipt({ ledger: restored.ledger, documents: restored.documents, folderNames: new Map(), result, base: restored.base ?? null, appVersion: '1.0' });
    const check = await verifyReceipt(receipt);
    expect(check.ok).toBe(true);
    expect(check.entries).toBe(2);
    expect(check.head?.seq).toBe(4);
  });

  it('produces a different head when history is rewritten', async () => {
    const { receipt: original } = await issued();
    const state = await library(['Document 1', 'Document 2']);
    const rewrittenBody = {
      seq: 3, documentId: 'doc-3', action: 'create' as const, name: 'Rewritten', folderId: 'work',
      pageCount: 1, pages: [{ id: 'page-3', sha256: state.pages[0].sha256 }], at: '2026-10-01T10:00:00.000Z',
      previousHash: state.ledger[1].hash,
    };
    const ledger = [...state.ledger, { ...rewrittenBody, hash: await entryHash(rewrittenBody) }];
    const result = await verifyVault({ ...state, ledger });
    const second = await buildReceipt({ ledger, documents: [...state.documents, { id: 'doc-3', name: 'Rewritten', folderId: 'work', pageIds: ['page-3'], createdAt: '2026-10-01T10:00:00.000Z' }], folderNames: new Map(), result, base: null, appVersion: '1.0' });
    expect(second.chain.through?.seq).toBe(3);
    expect(second.chain.through?.hash).not.toBe(original.chain.through?.hash);
  });

  it('serialises deterministically so the same facts always hash the same', async () => {
    expect(canonicalBody({ b: 1, a: [1, { d: 2, c: 3 }], z: null })).toBe(canonicalBody({ a: [1, { c: 3, d: 2 }], z: null, b: 1 }));
    const { receipt } = await issued();
    const { integrity, ...body } = receipt;
    expect(integrity.self).toBe(await selfDigest({ ...body }));
    expect(integrity.self).not.toBe(await selfDigest({ ...body, issuedAt: '2026-10-25T09:00:01.000Z' }));
  });
});
