'use client';

import { ArrowLeft, ChevronRight, Folder as FolderIcon, LayoutGrid, LoaderCircle, LockKeyhole, Plus, ScanLine, Search, WifiOff, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FOLDER_ID, Folder, readableError, ScanDocument } from '@/lib/model';
import * as storage from '@/lib/storage';
import { DocumentViewer } from './document-viewer';
import { DocumentSection, FolderSection, WelcomeCard } from './library';
import { ScanFlow } from './scan-flow';
import { Brand, Sidebar } from './sidebar';
import { Button, ConfirmDialog, ErrorMessage, IconButton, NameDialog, Toast } from './ui';

type DialogState = { kind: 'new-folder' } | { kind: 'rename-folder' | 'delete-folder'; folder: Folder } | { kind: 'rename-document' | 'delete-document'; doc: ScanDocument } | null;

export function Workspace() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState('');
  const [offlineReady, setOfflineReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextFolders = storage.readFolders();
      const nextDocuments = await storage.listDocuments();
      setFolders(nextFolders); setDocuments(nextDocuments); setStorageError('');
    } catch (err) { setStorageError(readableError(err)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // Hydrate the local library only after mount; these browser APIs cannot run at build time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const storageChanged = (event: StorageEvent) => { if (event.key === storage.FOLDERS_KEY) void refresh(); };
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', storageChanged); window.removeEventListener('focus', refresh); };
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    if (Capacitor.isNativePlatform()) {
      // Native assets are already bundled. A service worker here can cache an
      // old APK's JS across upgrades, so the Android shell deliberately skips it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOfflineReady(true);
      return;
    }
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(async () => {
        await navigator.serviceWorker.ready;
        if (!disposed) setOfflineReady(true);
      }).catch(() => { /* The library still works; the badge does not claim offline readiness. */ });
    }
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      const handle = await App.addListener('backButton', () => {
        const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
        const top = dialogs.at(-1);
        if (top) top.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
        else if (activeFolder || query) { setActiveFolder(null); setQuery(''); }
        else void App.minimizeApp();
      });
      if (disposed) void handle.remove(); else remove = () => { void handle.remove(); };
    }).catch(() => { /* Standard WebView navigation remains available. */ });
    return () => { disposed = true; remove?.(); };
  }, [activeFolder, query]);

  const openFolder = (id: string) => { setQuery(''); setActiveFolder(id); };
  const goHome = () => { setQuery(''); setActiveFolder(null); };
  const closeToast = useCallback(() => setToast(''), []);
  const closeDialog = () => setDialog(null);
  const folder = folders.find(f => f.id === activeFolder);
  const viewerDoc = documents.find(doc => doc.id === viewerId);
  const search = query.trim();
  const filtered = documents.filter(doc => search ? doc.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) : !activeFolder || doc.folderId === activeFolder);
  const defaultFolderName = folders.find(f => f.id === DEFAULT_FOLDER_ID)?.name || 'Unfiled';
  const createFolder = () => setDialog({ kind: 'new-folder' });
  const startScan = () => { if (!loading && !storageError) setScanning(true); };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to library</a>
    <Sidebar folders={folders} documents={documents} activeFolder={activeFolder} onHome={goHome} onFolder={openFolder} onCreate={createFolder} />
    <div className="workspace">
      <header className="topbar"><div className="desktop-breadcrumb"><LayoutGrid size={15} /><span>Workspace</span><ChevronRight size={13} /><strong>{folder?.name || 'My library'}</strong></div><button type="button" className="mobile-brand" onClick={goHome} aria-label="Go to library"><Brand compact /></button><div className="topbar-right"><div className="search-field"><Search size={18} /><input type="search" aria-label="Search documents by name" placeholder="Search your documents…" value={query} onChange={event => { setQuery(event.target.value); setActiveFolder(null); }} autoComplete="off" />{query && <IconButton aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></IconButton>}</div><span className={`offline-badge ${offlineReady ? 'ready' : ''}`} title={offlineReady ? 'The app’s files are available offline. Documents always stay on this device.' : 'Documents are stored locally. Browser offline mode is enabled after a production build is cached.'}>{offlineReady ? <WifiOff size={14} /> : <LockKeyhole size={14} />}{offlineReady ? 'Works offline' : 'On-device only'}</span></div></header>
      <main id="main-content" className="main-content">
        <div className="page-heading"><div>{activeFolder && <button className="back-to-library" type="button" onClick={goHome}><ArrowLeft size={14} />My library</button>}<div className="page-title-row">{folder && <span className={`folder-title-icon ${folder.color}`}><FolderIcon size={24} /></span>}<h1>{search ? 'Find your paperwork.' : folder?.name || 'My library'}</h1></div><p>{search ? 'A familiar name is all you need.' : folder ? `${filtered.length} ${filtered.length === 1 ? 'document' : 'documents'}, right where you need them.` : 'Everything important. Nothing scattered.'}</p></div><Button className="desktop-scan-button" onClick={startScan} disabled={loading || Boolean(storageError)}><Plus size={19} />Scan document</Button></div>
        {storageError && <div className="storage-error"><ErrorMessage>{storageError}</ErrorMessage><Button variant="secondary" onClick={() => void refresh()}>Retry storage</Button></div>}
        {!activeFolder && !search && documents.length === 0 && <WelcomeCard />}
        {loading ? <div className="library-loading" role="status"><LoaderCircle className="spin" size={25} /><span>Opening your on-device library…</span></div> : <>
          {!activeFolder && !search && <FolderSection folders={folders} documents={documents} onOpen={openFolder} onCreate={createFolder} onRename={selected => setDialog({ kind: 'rename-folder', folder: selected })} onDelete={selected => setDialog({ kind: 'delete-folder', folder: selected })} />}
          <DocumentSection documents={filtered} folders={folders} query={search} inFolder={Boolean(activeFolder)} onOpen={doc => setViewerId(doc.id)} onClearSearch={() => setQuery('')} onScan={startScan} />
        </>}
        <footer className="library-footer"><LockKeyhole size={12} /><span>A little more organized. Entirely on your device.</span></footer>
      </main>
      <div className="mobile-scan-bar"><Button onClick={startScan} disabled={loading || Boolean(storageError)}><ScanLine size={20} />Scan document</Button></div>
    </div>
    {scanning && <ScanFlow folders={folders} initialFolder={activeFolder || DEFAULT_FOLDER_ID} onClose={() => setScanning(false)} onSave={async (name, folderId, pages, thumbnail) => {
      const saved = await storage.saveDocument(name, folderId, pages, thumbnail);
      setDocuments(previous => [saved, ...previous]); setScanning(false); setActiveFolder(saved.folderId); setQuery(''); setToast('Document saved. A little less paper, a little more order.');
    }} />}
    {viewerDoc && <DocumentViewer doc={viewerDoc} folder={folders.find(f => f.id === viewerDoc.folderId)} onClose={() => setViewerId(null)} onRename={() => setDialog({ kind: 'rename-document', doc: viewerDoc })} onDelete={() => setDialog({ kind: 'delete-document', doc: viewerDoc })} notify={setToast} />}
    {dialog?.kind === 'new-folder' && <NameDialog title="A place for everything." description="Give your new folder a name that feels right." label="Folder name" confirmLabel="Create folder" onClose={closeDialog} onSubmit={name => { storage.createFolder(name); setFolders(storage.readFolders()); setToast('New folder created. Ready for what matters.'); }} />}
    {dialog?.kind === 'rename-folder' && <NameDialog title="Rename folder" description="Same documents. A new name." label="Folder name" confirmLabel="Save name" initialValue={dialog.folder.name} onClose={closeDialog} onSubmit={name => { storage.renameFolder(dialog.folder.id, name); setFolders(storage.readFolders()); setToast('Folder renamed.'); }} />}
    {dialog?.kind === 'delete-folder' && <ConfirmDialog title={`Delete “${dialog.folder.name}”?`} description={<>The folder will be removed. Any documents inside will move to <strong>{defaultFolderName}</strong>—nothing will be lost.</>} confirmLabel="Delete folder" onClose={closeDialog} onConfirm={async () => {
      try { await storage.deleteFolder(dialog.folder.id); if (activeFolder === dialog.folder.id) setActiveFolder(null); setToast(`Folder deleted. Documents are safe in ${defaultFolderName}.`); } finally { await refresh(); }
    }} />}
    {dialog?.kind === 'rename-document' && <NameDialog title="Rename document" description="Make it a little easier to find next time." label="Document name" confirmLabel="Save name" initialValue={dialog.doc.name} onClose={closeDialog} onSubmit={async name => { await storage.renameDocument(dialog.doc.id, name); await refresh(); setToast('Document renamed.'); }} />}
    {dialog?.kind === 'delete-document' && <ConfirmDialog title="Delete this document?" description={<>“{dialog.doc.name}” and all {dialog.doc.pageIds.length} {dialog.doc.pageIds.length === 1 ? 'page' : 'pages'} will be permanently deleted from this device. This can’t be undone.</>} confirmLabel="Delete document" onClose={closeDialog} onConfirm={async () => { await storage.deleteDocument(dialog.doc.id); setViewerId(null); setDocuments(previous => previous.filter(doc => doc.id !== dialog.doc.id)); setToast('Document deleted from this device.'); }} />}
    {toast && <Toast message={toast} onClose={closeToast} />}
  </div>;
}
