import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storage from '@/lib/storage';
import { DEFAULT_FOLDER_ID, DraftPage } from '@/lib/model';

class LocalStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
let local: LocalStorage;
const page = (id: string): DraftPage => ({ id, image: new Blob([`image-${id}`], { type: 'image/jpeg' }), width: 600, height: 800 });
const thumbnail = new Blob(['thumbnail'], { type: 'image/jpeg' });

beforeEach(async () => {
  await storage.closeDatabase();
  await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(storage.DB_NAME); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
  local = new LocalStorage(); vi.stubGlobal('localStorage', local);
});
afterEach(async () => { await storage.closeDatabase(); vi.unstubAllGlobals(); });

describe('local library', () => {
  it('creates four empty folders once and persists names in localStorage', () => {
    const folders = storage.readFolders();
    expect(folders).toHaveLength(4); expect(folders[0].id).toBe(DEFAULT_FOLDER_ID);
    expect(local.getItem(storage.FOLDERS_KEY)).toContain('Receipts');
    expect(storage.readFolders()).toEqual(folders);
  });
  it('creates and renames folders, rejecting blank and duplicate names', () => {
    const folder = storage.createFolder('  Taxes  ');
    expect(folder.name).toBe('Taxes');
    expect(() => storage.createFolder('taxes')).toThrow('already exists');
    expect(() => storage.createFolder(' ')).toThrow('enter a name');
    storage.renameFolder(folder.id, 'Tax records');
    expect(storage.readFolders().find(f => f.id === folder.id)?.name).toBe('Tax records');
    expect(() => storage.renameFolder(folder.id, 'Receipts')).toThrow('already exists');
  });
  it('saves metadata, thumbnail and ordered binary pages in IndexedDB', async () => {
    const doc = await storage.saveDocument('Receipt', 'receipts', [page('one'), page('two')], thumbnail);
    expect((await storage.listDocuments())[0]).toEqual(doc);
    const pages = await storage.getPages(doc);
    expect(pages.map(p => p.id)).toEqual(['one', 'two']);
    expect(await pages[0].image.text()).toBe('image-one');
    expect(pages[0].documentId).toBe(doc.id);
    expect((await storage.listDocuments())[0].thumbnail).toBeInstanceOf(Blob);
    expect(local.getItem(storage.FOLDERS_KEY)).not.toContain('image-one');
  });
  it('uses the default folder for a missing or deleted destination', async () => {
    const doc = await storage.saveDocument('Unfiled scan', 'missing', [page('one')], thumbnail);
    expect(doc.folderId).toBe(DEFAULT_FOLDER_ID);
  });
  it('stores the selected page order rather than capture order', async () => {
    const doc = await storage.saveDocument('Reordered', 'work', [page('two'), page('one')], thumbnail);
    expect((await storage.getPages(doc)).map(p => p.id)).toEqual(['two', 'one']);
  });
  it('renames a document without changing its creation date or pages', async () => {
    const original = await storage.saveDocument('Original', 'personal', [page('one')], thumbnail);
    await storage.renameDocument(original.id, 'New name');
    const doc = (await storage.listDocuments())[0];
    expect(doc.name).toBe('New name'); expect(doc.createdAt).toBe(original.createdAt); expect(doc.pageIds).toEqual(original.pageIds);
    expect(await (await storage.getPages(doc))[0].image.text()).toBe('image-one');
  });
  it('deletes both a document and its binary pages atomically', async () => {
    const doc = await storage.saveDocument('Delete me', 'work', [page('one'), page('two')], thumbnail);
    await storage.deleteDocument(doc.id);
    expect(await storage.listDocuments()).toEqual([]);
    const db = await storage.openDatabase();
    const count = await new Promise<number>(resolve => { const req = db.transaction('pages').objectStore('pages').count(); req.onsuccess = () => resolve(req.result); });
    expect(count).toBe(0);
  });
  it('moves documents to the default when a folder is deleted; never deletes pages', async () => {
    await storage.saveDocument('Important', 'work', [page('one')], thumbnail);
    await storage.deleteFolder('work');
    const doc = (await storage.listDocuments())[0];
    expect(doc.folderId).toBe(DEFAULT_FOLDER_ID); expect(storage.readFolders().some(f => f.id === 'work')).toBe(false);
    expect(await (await storage.getPages(doc))[0].image.text()).toBe('image-one');
    await expect(storage.deleteFolder(DEFAULT_FOLDER_ID)).rejects.toThrow('cannot be deleted');
  });
  it('rolls back an entire document save if a page write fails', async () => {
    await storage.saveDocument('Existing', 'work', [page('existing')], thumbnail);
    await expect(storage.saveDocument('Interrupted', 'work', [page('new'), page('existing')], thumbnail)).rejects.toBeTruthy();
    expect((await storage.listDocuments()).map(doc => doc.name)).toEqual(['Existing']);
    const db = await storage.openDatabase();
    const orphan = await new Promise(resolve => { const req = db.transaction('pages').objectStore('pages').get('new'); req.onsuccess = () => resolve(req.result); });
    expect(orphan).toBeUndefined();
  });
  it('keeps scans reachable if the folder metadata write fails during deletion', async () => {
    await storage.saveDocument('Important', 'work', [page('one')], thumbnail);
    vi.spyOn(local, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(storage.deleteFolder('work')).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(storage.readFolders().some(f => f.id === 'work')).toBe(true);
    expect((await storage.listDocuments())[0].folderId).toBe(DEFAULT_FOLDER_ID);
  });
  it('does not silently discard a corrupt folder list or fall back to memory', () => {
    local.setItem(storage.FOLDERS_KEY, '{bad');
    expect(() => storage.readFolders()).toThrow('scans are still on this device');
    local.clear();
    vi.spyOn(local, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    expect(() => storage.readFolders()).toThrow('Denied');
  });
  it('rejects empty documents and duplicate page IDs', async () => {
    await expect(storage.saveDocument('Empty', 'work', [], thumbnail)).rejects.toThrow('at least one');
    await expect(storage.saveDocument('Bad', 'work', [page('one'), page('one')], thumbnail)).rejects.toThrow('retake');
  });
});
