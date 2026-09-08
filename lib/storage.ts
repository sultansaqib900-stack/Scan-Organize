import { cleanName, DEFAULT_FOLDER_ID, DraftPage, Folder, FolderColor, MAX_PAGES, newId, ScanDocument, ScanPage } from './model';

export const DB_NAME = 'scan-organize';
export const FOLDERS_KEY = 'scan-organize:folders:v1';
const DB_VERSION = 1;
let database: Promise<IDBDatabase> | undefined;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
      const docs = db.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('folderId', 'folderId');
      const pages = db.createObjectStore('pages', { keyPath: 'id' });
      pages.createIndex('documentId', 'documentId');
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
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'pages'], 'readwrite');
  const done = complete(tx);
  tx.objectStore('documents').add(doc);
  for (const page of pages) tx.objectStore('pages').add({ ...page, documentId: id } satisfies ScanPage);
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
  const tx = db.transaction('documents', 'readwrite');
  const done = complete(tx);
  const store = tx.objectStore('documents');
  const req = store.get(id);
  let missing = false;
  req.onsuccess = () => {
    const doc: ScanDocument | undefined = req.result;
    if (!doc) { missing = true; return; }
    store.put({ ...doc, name, updatedAt: new Date().toISOString() });
  };
  await done;
  if (missing) throw new Error('This document no longer exists.');
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'pages'], 'readwrite');
  const done = complete(tx);
  tx.objectStore('documents').delete(id);
  const cursor = tx.objectStore('pages').index('documentId').openCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (item) { item.delete(); item.continue(); }
  };
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
