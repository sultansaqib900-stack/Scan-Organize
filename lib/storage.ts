import { blobDigest } from './digest';
import { entryHash, LEDGER_VERSION, LedgerEntry, pageDigests, VaultState } from './ledger';
import { cleanName, DEFAULT_FOLDER_ID, DraftPage, Folder, FolderColor, MAX_PAGES, newId, ScanDocument, ScanPage } from './model';

export const DB_NAME = 'scan-organize';
export const FOLDERS_KEY = 'scan-organize:folders:v1';
export const VAULT_STATE_KEY = 'scan-organize:vault:v1';
/**
 * Schema history:
 *  1 — documents + pages.
 *  2 — page `sha256` for cheap integrity re-checks, `ledger` (hash-chained custody
 *      events) and `vault` (chain base + last audit, so a restored snapshot can
 *      still be audited from its origin).
 */
const DB_VERSION = 2;

/** Stored marker: not the verification input, just what this device remembers. */
export interface VaultMarker {
  version: number;
  /** Chain position a restored ledger starts from (null on a device of origin). */
  base: { seq: number; hash: string } | null;
  /** Last start-to-finish audit performed on this device. */
  audited: { head: { seq: number; hash: string } | null; at: string } | null;
}

const EMPTY_MARKER: VaultMarker = { version: LEDGER_VERSION, base: null, audited: null };
let database: Promise<IDBDatabase> | undefined;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A request failure aborts the transaction, which `complete()` reports. Settling
 *  here keeps the same failure from surfacing twice as an unhandled rejection. */
function settle<T>(promise: Promise<T>): Promise<undefined> {
  return promise.then(() => undefined, () => undefined);
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('The save was interrupted. Please try again.'));
    tx.onerror = () => { /* onabort reports the transaction error; never report a partial save. */ };
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('On-device storage is unavailable. Enable browser storage or use the Android app.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Idempotent on purpose: a second upgrade attempt must never throw
      // ConstraintError and lock an existing install out of its own library.
      if (!db.objectStoreNames.contains('documents')) {
        const docs = db.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('folderId', 'folderId');
      }
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('documentId', 'documentId');
      }
      if (!db.objectStoreNames.contains('ledger')) {
        const ledger = db.createObjectStore('ledger', { keyPath: 'seq' });
        ledger.createIndex('documentId', 'documentId');
      }
      if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault', { keyPath: 'key' });
      // Version 1 pages have no `sha256`. It is deliberately NOT backfilled here:
      // hashing is async and the upgrade transaction would commit before it
      // resolved. Readers (`listPages`) and the baseline audit fill it in.
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Scan & Organize tabs, then try again to open your library.'));
  });
  database.catch(() => { database = undefined; });
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (database) (await database).close();
  database = undefined;
}

/* ---------------------------------------------------------------------------
 * Folders (metadata only; unchanged public behaviour)
 * ------------------------------------------------------------------------- */

export function readFolders(): Folder[] {
  const raw = localStorage.getItem(FOLDERS_KEY);
  if (raw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Your folder list could not be read. Your scans are still on this device. Please do not clear app data.'); }
    if (!Array.isArray(parsed) || !parsed.every(f => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.createdAt === 'string' && ['sage', 'sand', 'blue', 'lavender'].includes(f.color))) {
      throw new Error('Your folder list could not be read. Your scans are still on this device. Please do not clear app data.');
    }
    const folders = parsed as Folder[];
    if (!folders.some(f => f.id === DEFAULT_FOLDER_ID)) {
      folders.unshift({ id: DEFAULT_FOLDER_ID, name: 'Unfiled', color: 'sage', createdAt: new Date().toISOString() });
      writeFolders(folders);
    }
    return folders;
  }
  const createdAt = new Date().toISOString();
  const defaults: Folder[] = [
    { id: DEFAULT_FOLDER_ID, name: 'Unfiled', color: 'sage', createdAt },
    { id: 'receipts', name: 'Receipts', color: 'sand', createdAt },
    { id: 'personal', name: 'Personal', color: 'blue', createdAt },
    { id: 'work', name: 'Work', color: 'lavender', createdAt },
  ];
  writeFolders(defaults);
  return defaults;
}

function writeFolders(folders: Folder[]): void {
  // Do not fall back to volatile memory when local storage is denied/full.
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

export function createFolder(rawName: string): Folder {
  const name = cleanName(rawName);
  const folders = readFolders();
  if (folders.some(f => f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A folder with this name already exists.');
  const colors: FolderColor[] = ['sage', 'sand', 'blue', 'lavender'];
  const folder: Folder = { id: newId(), name, color: colors[folders.length % colors.length], createdAt: new Date().toISOString() };
  writeFolders([...folders, folder]);
  return folder;
}

export function renameFolder(id: string, rawName: string): void {
  const name = cleanName(rawName);
  const folders = readFolders();
  if (!folders.some(f => f.id === id)) throw new Error('This folder no longer exists.');
  if (folders.some(f => f.id !== id && f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A folder with this name already exists.');
  writeFolders(folders.map(f => f.id === id ? { ...f, name } : f));
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------- */

export async function listDocuments(): Promise<ScanDocument[]> {
  const db = await openDatabase();
  const documents = await request<ScanDocument[]>(db.transaction('documents').objectStore('documents').getAll());
  return documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPages(doc: ScanDocument): Promise<ScanPage[]> {
  const db = await openDatabase();
  const store = db.transaction('pages').objectStore('pages');
  const pages = await Promise.all(doc.pageIds.map(id => request<ScanPage | undefined>(store.get(id))));
  if (pages.some(page => !page)) throw new Error('A page could not be loaded from this device. Try reopening the document.');
  return pages as ScanPage[];
}

export async function listPages(): Promise<Array<ScanPage & { sha256: string }>> {
  const db = await openDatabase();
  const pages = await request<Array<ScanPage & { sha256?: string }>>(db.transaction('pages').objectStore('pages').getAll());
  // A record whose image is not a Blob is corruption, not a reason to crash the
  // whole check: report an empty digest so verification flags that one page.
  return Promise.all(pages.map(async page => ({
    ...page,
    sha256: page.sha256 ?? (page.image instanceof Blob ? await blobDigest(page.image) : ''),
  })));
}

export async function readLedger(): Promise<LedgerEntry[]> {
  const db = await openDatabase();
  return request<LedgerEntry[]>(db.transaction('ledger').objectStore('ledger').getAll());
}

export async function readVaultMarker(): Promise<VaultMarker> {
  const db = await openDatabase();
  const record = await request<{ key: string; value: VaultMarker } | undefined>(db.transaction('vault').objectStore('vault').get('state'));
  return { ...EMPTY_MARKER, ...(record?.value ?? {}) };
}

/** Everything verification and receipts need, in one read. */
export async function readVault(): Promise<{ snapshot: VaultState; folders: Folder[]; marker: VaultMarker }> {
  const [ledger, documents, pages] = await Promise.all([readLedger(), listDocuments(), listPages()]);
  const folders = readFolders();
  const marker = await readVaultMarker();
  return {
    snapshot: { ledger, documents, pages, folderIds: folders.map(folder => folder.id), base: marker.base },
    folders,
    marker,
  };
}

/* ---------------------------------------------------------------------------
 * Writes
 *
 * Every transaction body below is synchronous: the entry hash and page digests
 * are computed *before* the transaction opens. IndexedDB transactions auto-commit
 * once no request is pending, so awaiting inside one is a correctness hazard.
 * ------------------------------------------------------------------------- */

async function buildEntry(
  head: { seq: number; hash: string } | null,
  event: Pick<LedgerEntry, 'documentId' | 'action' | 'name' | 'folderId' | 'pageCount' | 'pages'> & { previousName?: string },
): Promise<LedgerEntry> {
  const body = {
    seq: (head?.seq ?? 0) + 1,
    documentId: event.documentId,
    action: event.action,
    name: event.name,
    previousName: event.previousName,
    folderId: event.folderId,
    pageCount: event.pageCount,
    pages: event.pages,
    at: new Date().toISOString(),
    previousHash: head?.hash ?? null,
  };
  return { ...body, hash: await entryHash(body) };
}

async function head(): Promise<{ seq: number; hash: string } | null> {
  const entries = await readLedger();
  const last = entries.at(-1);
  return last ? { seq: last.seq, hash: last.hash } : null;
}

export async function saveDocument(rawName: string, folderId: string, pages: DraftPage[], thumbnail: Blob): Promise<ScanDocument> {
  const name = cleanName(rawName);
  if (!pages.length) throw new Error('Add at least one page before saving.');
  if (pages.length > MAX_PAGES) throw new Error(`A document can have up to ${MAX_PAGES} pages.`);
  if (new Set(pages.map(p => p.id)).size !== pages.length || pages.some(p => !p.image.size || p.width <= 0 || p.height <= 0)) throw new Error('One of the pages could not be saved. Please retake it.');
  const folders = readFolders();
  const destination = folders.some(f => f.id === folderId) ? folderId : DEFAULT_FOLDER_ID;
  const id = newId();
  const now = new Date().toISOString();
  const doc: ScanDocument = { id, name, folderId: destination, createdAt: now, updatedAt: now, pageIds: pages.map(p => p.id), thumbnail };
  const digests = await pageDigests(pages);
  const entry = await buildEntry(await head(), { documentId: id, action: 'create', name, folderId: destination, pageCount: pages.length, pages: digests });
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'pages', 'ledger'], 'readwrite');
  const done = complete(tx);
  // A concurrent writer that took this seq aborts the whole transaction rather
  // than leaving a document without a ledger entry.
  const writes = [
    settle(request(tx.objectStore('documents').add(doc))),
    ...pages.map((page, index) => settle(request(tx.objectStore('pages').add({ ...page, documentId: id, sha256: digests[index].sha256 } satisfies ScanPage)))),
    settle(request(tx.objectStore('ledger').add(entry))),
  ];
  await Promise.all(writes);
  await done;
  // A best-effort hint, not a dependency: WebView may not implement this API.
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => false);
  }
  return doc;
}

export async function renameDocument(id: string, rawName: string): Promise<void> {
  const name = cleanName(rawName);
  const db = await openDatabase();
  const existing = await request<ScanDocument | undefined>(db.transaction('documents').objectStore('documents').get(id));
  if (!existing) throw new Error('This document no longer exists.');
  if (existing.name === name) return;
  const pages = await request<Array<ScanPage & { sha256?: string }>>(db.transaction('pages').objectStore('pages').index('documentId').getAll(IDBKeyRange.only(id)));
  const entry = await buildEntry(await head(), {
    documentId: id, action: 'rename', name, previousName: existing.name, folderId: existing.folderId,
    pageCount: existing.pageIds.length,
    pages: pages.filter(Boolean).map(page => ({ id: page.id, sha256: page.sha256 ?? '' })),
  });
  const tx = db.transaction(['documents', 'ledger'], 'readwrite');
  const done = complete(tx);
  await Promise.all([
    settle(request(tx.objectStore('documents').put({ ...existing, name, updatedAt: new Date().toISOString() }))),
    settle(request(tx.objectStore('ledger').add(entry))),
  ]);
  await done;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  const existing = await request<ScanDocument | undefined>(db.transaction('documents').objectStore('documents').get(id));
  const entry = existing ? await buildEntry(await head(), { documentId: id, action: 'delete', name: existing.name, folderId: existing.folderId, pageCount: existing.pageIds.length, pages: [] }) : null;
  const tx = db.transaction(['documents', 'pages', 'ledger'], 'readwrite');
  const done = complete(tx);
  const writes: Array<Promise<unknown>> = [settle(request(tx.objectStore('documents').delete(id)))];
  if (entry) writes.push(settle(request(tx.objectStore('ledger').add(entry))));
  const cursor = tx.objectStore('pages').index('documentId').openCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (item) { item.delete(); item.continue(); }
  };
  await Promise.all(writes);
  await done;
}

export async function deleteFolder(id: string): Promise<void> {
  if (id === DEFAULT_FOLDER_ID) throw new Error('The default folder keeps every document safely filed and cannot be deleted.');
  const folders = readFolders();
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const done = complete(tx);
  const cursor = tx.objectStore('documents').index('folderId').openCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (item) { item.update({ ...item.value, folderId: DEFAULT_FOLDER_ID }); item.continue(); }
  };
  await done;
  // Move first, remove folder second. A failed localStorage write leaves an empty
  // folder rather than orphaning/deleting any documents across these two stores.
  writeFolders(folders.filter(f => f.id !== id));
}

/* ---------------------------------------------------------------------------
 * Integrity bookkeeping
 * ------------------------------------------------------------------------- */

/** Appends a baseline event for a document the ledger predates (v1 upgrades). */
export async function recordBaseline(documents: Array<Pick<ScanDocument, 'id' | 'name' | 'folderId' | 'pageIds'>>): Promise<number> {
  if (!documents.length) return 0;
  const db = await openDatabase();
  const pages = await request<Array<ScanPage & { sha256?: string }>>(db.transaction('pages').objectStore('pages').getAll());
  const byId = new Map(pages.map(page => [page.id, page]));
  const entries: LedgerEntry[] = [];
  let head = await readLedger().then(entries => entries.at(-1) ? { seq: entries.at(-1)!.seq, hash: entries.at(-1)!.hash } : null);
  for (const doc of documents) {
    const digests = await Promise.all(doc.pageIds.map(async pageId => {
      const page = byId.get(pageId);
      if (!page) throw new Error(`“${doc.name}” is missing a page. Cannot record an integrity baseline for it.`);
      return { id: page.id, sha256: page.sha256 ?? await blobDigest(page.image) };
    }));
    const entry = await buildEntry(head, { documentId: doc.id, action: 'create', name: doc.name, folderId: doc.folderId, pageCount: doc.pageIds.length, pages: digests });
    entries.push(entry);
    head = { seq: entry.seq, hash: entry.hash };
  }
  const tx = db.transaction('ledger', 'readwrite');
  const done = complete(tx);
  await Promise.all(entries.map(entry => settle(request(tx.objectStore('ledger').add(entry)))));
  await done;
  return entries.length;
}

export async function markAudited(auditedThrough: { seq: number; hash: string } | null, at = new Date().toISOString()): Promise<void> {
  const db = await openDatabase();
  const marker = await readVaultMarker();
  const tx = db.transaction('vault', 'readwrite');
  const done = complete(tx);
  await settle(request(tx.objectStore('vault').put({ key: 'state', value: { ...marker, audited: { head: auditedThrough, at } } satisfies VaultMarker })));
  await done;
}

/**
 * Applies a restored ledger/vault pair. Entries keep their original hashes so the
 * imported chain is still auditable against the head a receipt names.
 */
export async function importVaultSnapshot(snapshot: { ledger: LedgerEntry[]; base: { seq: number; hash: string } | null }): Promise<void> {
  const db = await openDatabase();
  const marker = await readVaultMarker();
  const last = snapshot.ledger.at(-1);
  const tx = db.transaction(['ledger', 'vault'], 'readwrite');
  const done = complete(tx);
  const ledger = tx.objectStore('ledger');
  ledger.clear();
  const writes = snapshot.ledger.map(entry => settle(request(ledger.add(entry))));
  writes.push(settle(request(tx.objectStore('vault').put({
    key: 'state',
    value: {
      ...marker,
      base: snapshot.base,
      audited: snapshot.base ? { head: last ? { seq: last.seq, hash: last.hash } : null, at: new Date().toISOString() } : null,
    } satisfies VaultMarker,
  }))));
  await Promise.all(writes);
  await done;
}
