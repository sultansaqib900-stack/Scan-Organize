import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storage from '@/lib/storage';
import { verifyVault } from '@/lib/ledger';
import { blobDigest } from '@/lib/digest';
import { DEFAULT_FOLDER_ID, DraftPage } from '@/lib/model';

class LocalStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
let local: LocalStorage;
const page = (id: string, body = `image-${id}`): DraftPage => ({ id, image: new Blob([body], { type: 'image/jpeg' }), width: 600, height: 800 });
const thumbnail = new Blob(['thumbnail'], { type: 'image/jpeg' });

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await storage.closeDatabase();
  await deleteDatabase(storage.DB_NAME);
  local = new LocalStorage(); vi.stubGlobal('localStorage', local);
});
afterEach(async () => { await storage.closeDatabase(); vi.unstubAllGlobals(); });

describe('custody ledger writes', () => {
  it('records a linked, correctly hashed entry for every save, rename and delete', async () => {
    const doc = await storage.saveDocument('Receipt', 'receipts', [page('one'), page('two')], thumbnail);
    await storage.renameDocument(doc.id, 'Tax receipt');
    await storage.deleteDocument(doc.id);
    const ledger = await storage.readLedger();
    expect(ledger.map(entry => entry.action)).toEqual(['create', 'rename', 'delete']);
    expect(ledger.map(entry => entry.seq)).toEqual([1, 2, 3]);
    expect(ledger[0].previousHash).toBeNull();
    expect(ledger[1].previousHash).toBe(ledger[0].hash);
    expect(ledger[2].previousHash).toBe(ledger[1].hash);
    expect(ledger[1].previousName).toBe('Receipt');
    expect(ledger[1].name).toBe('Tax receipt');
    expect(ledger[0].pages.map(p => p.id)).toEqual(['one', 'two']);
    // The recorded digest is the digest of the bytes actually stored.
    expect(ledger[0].pages[0].sha256).toBe(await blobDigest(page('one').image));
  });

  it('stores the page digest with the page so a later check is cheap', async () => {
    await storage.saveDocument('Digested', 'work', [page('one')], thumbnail);
    const pages = await storage.listPages();
    expect(pages[0].sha256).toBe(await blobDigest(pages[0].image));
  });

  it('rolls the ledger back with a failed document save', async () => {
    await storage.saveDocument('Existing', 'work', [page('existing')], thumbnail);
    await expect(storage.saveDocument('Interrupted', 'work', [page('dupe'), page('dupe')], thumbnail)).rejects.toBeTruthy();
    expect((await storage.readLedger()).map(entry => entry.name)).toEqual(['Existing']);
  });

  it('does not append a rename entry when the name is unchanged', async () => {
    const doc = await storage.saveDocument('Same', 'work', [page('one')], thumbnail);
    await storage.renameDocument(doc.id, 'Same');
    expect(await storage.readLedger()).toHaveLength(1);
  });
});

describe('vault verification', () => {
  async function snapshot() {
    const { snapshot: state, marker } = await storage.readVault();
    return { ...state, base: marker.base };
  }

  it('reports a pristine library as verified from a complete chain', async () => {
    await storage.saveDocument('One', 'work', [page('one')], thumbnail);
    await storage.saveDocument('Two', 'work', [page('two'), page('three')], thumbnail);
    const result = await verifyVault(await snapshot());
    expect(result.ok).toBe(true);
    expect(result.chain).toBe('audited');
    expect(result.documentsHealthy).toBe(2);
    expect(result.entries).toBe(2);
    expect(result.pages).toBe(3);
    expect(result.issues).toEqual([]);
  });

  it('names the exact page whose stored bytes changed', async () => {
    const doc = await storage.saveDocument('Report', 'work', [page('good'), page('bad')], thumbnail);
    const db = await storage.openDatabase();
    // Replace the bytes but keep the recorded digest, so only a re-read detects it.
    const recorded = (await storage.readLedger())[0].pages[1].sha256;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put({ id: 'bad', documentId: doc.id, image: new Blob(['tampered'], { type: 'image/jpeg' }), width: 600, height: 800, sha256: recorded });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const result = await verifyVault(await snapshot());
    expect(result.ok).toBe(false);
    expect(result.corruptedPages).toBe(1);
    const issue = result.issues.find(item => item.kind === 'page-corrupt');
    expect(issue?.pageNumber).toBe(2);
    expect(issue?.label).toBe('“Report” page 2');
  });

  it('detects an edited ledger entry', async () => {
    await storage.saveDocument('Original', 'work', [page('one')], thumbnail);
    const db = await storage.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ledger', 'readwrite');
      const store = tx.objectStore('ledger');
      const get = store.get(1);
      get.onsuccess = () => store.put({ ...get.result, name: 'Rewritten' });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const result = await verifyVault(await snapshot());
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.kind === 'ledger-hash-mismatch')).toBe(true);
  });

  it('detects a removed ledger entry as a gap and a broken link', async () => {
    await storage.saveDocument('One', 'work', [page('one')], thumbnail);
    await storage.saveDocument('Two', 'work', [page('two')], thumbnail);
    await storage.saveDocument('Three', 'work', [page('three')], thumbnail);
    const db = await storage.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ledger', 'readwrite');
      tx.objectStore('ledger').delete(2);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const result = await verifyVault(await snapshot());
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.kind === 'ledger-segment-missing')).toBe(true);
    expect(result.issues.some(issue => issue.kind === 'ledger-link-broken')).toBe(true);
    expect(result.issues.some(issue => issue.kind === 'document-untracked' && issue.label === '“Two”')).toBe(true);
  });

  it('reports a document the ledger records but storage no longer has', async () => {
    const doc = await storage.saveDocument('Vanishing', 'work', [page('one')], thumbnail);
    const db = await storage.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').delete(doc.id);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const result = await verifyVault(await snapshot());
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.kind === 'document-missing' && issue.label === '“Vanishing”')).toBe(true);
  });

  it('stops re-reading bytes outside the budget but still returns a verdict', async () => {
    await storage.saveDocument('Big', 'work', [page('one', 'x'.repeat(4096))], thumbnail);
    const result = await verifyVault(await snapshot(), { budgetBytes: 0 });
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.chain).toBe('partial');
    expect(result.checkedBytes).toBe(0);
    expect(result.trustedBytes).toBe(4096);
  });
});

describe('version 1 to version 2 upgrade', () => {
  /** Seeds a real v1 database: v1 schema, v1-shaped records, no digest. */
  async function seedV1() {
    const document = { id: 'legacy-doc', name: 'Old receipt', folderId: DEFAULT_FOLDER_ID, createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z', pageIds: ['legacy-page'], thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }) };
    const legacyPage = { id: 'legacy-page', documentId: 'legacy-doc', image: new Blob(['legacy-bytes'], { type: 'image/jpeg' }), width: 600, height: 800 };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(storage.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const docs = db.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('folderId', 'folderId');
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('documentId', 'documentId');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['documents', 'pages'], 'readwrite');
        tx.objectStore('documents').put(document);
        tx.objectStore('pages').put(legacyPage);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  it('opens an existing v1 library without losing documents or pages', async () => {
    await seedV1();
    expect((await storage.listDocuments()).map(doc => doc.name)).toEqual(['Old receipt']);
    const pages = await storage.listPages();
    expect(pages[0].id).toBe('legacy-page');
    expect(await pages[0].image.text()).toBe('legacy-bytes');
    // A v1 page has no stored digest; one is derived from the bytes on read.
    expect(pages[0].sha256).toBe(await blobDigest(pages[0].image));
  });

  it('reports pre-ledger documents honestly, then covers them with a baseline', async () => {
    await seedV1();
    const { snapshot, marker } = await storage.readVault();
    const result = await verifyVault({ ...snapshot, base: marker.base });
    expect(result.issues.some(issue => issue.kind === 'document-untracked')).toBe(true);

    expect(await storage.recordBaseline(snapshot.documents)).toBe(1);
    const after = await storage.readVault();
    const audited = await verifyVault({ ...after.snapshot, base: after.marker.base });
    expect(audited.ok).toBe(true);
    expect(audited.chain).toBe('audited');
  });

  it('reopens an upgraded database without duplicate-store errors', async () => {
    await seedV1();
    await storage.saveDocument('After upgrade', 'work', [page('one')], thumbnail);
    await storage.closeDatabase();
    await expect(storage.listDocuments()).resolves.toHaveLength(2);
    await storage.closeDatabase();
    await expect(storage.listDocuments()).resolves.toHaveLength(2);
  });
});
