'use client';

import { ArrowUpRight, FileText, Folder as FolderIcon, MoreHorizontal, Pencil, Plus, SearchX, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FOLDER_ID, Folder, formatDate, ScanDocument } from '@/lib/model';
import { useObjectUrl } from '@/lib/hooks';
import { EmptyDocumentsIllustration, FolderGlyph, ScanIllustration } from './illustrations';
import { Button, IconButton } from './ui';

export function WelcomeCard() {
  return <section className="welcome-card" aria-label="A home for your paperwork"><div className="welcome-copy"><span className="eyebrow"><span className="tiny-line" /> A HOME FOR YOUR PAPERWORK</span><h2>Less paper.<br />More peace of mind.</h2><p>Scan what matters. Keep it organized.<br />Always private, always with you.</p><span className="welcome-note"><ShieldCheck size={15} /> Your documents. Your device.</span></div><ScanIllustration /></section>;
}

function FolderMenu({ folder, onRename, onDelete }: { folder: Folder; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="folder-menu" ref={ref}><IconButton aria-label={`Actions for ${folder.name}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={21} /></IconButton>{open && <div className="folder-popover" role="group" aria-label={`${folder.name} actions`}><button type="button" onClick={() => { setOpen(false); onRename(); }}><Pencil size={15} />Rename folder</button>{folder.id !== DEFAULT_FOLDER_ID ? <button type="button" className="delete-action" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={15} />Delete folder</button> : <span className="default-folder-note">Your default folder</span>}</div>}</div>;
}

export function FolderSection({ folders, documents, onOpen, onCreate, onRename, onDelete }: { folders: Folder[]; documents: ScanDocument[]; onOpen: (id: string) => void; onCreate: () => void; onRename: (folder: Folder) => void; onDelete: (folder: Folder) => void }) {
  return <section className="folders-section"><div className="section-heading"><h2>Folders <span className="count-badge">{folders.length}</span></h2><Button variant="ghost" onClick={onCreate}><Plus size={17} />New folder</Button></div><div className="folder-grid">{folders.map(folder => {
    const count = documents.filter(doc => doc.folderId === folder.id).length;
    return <div className={`folder-card ${folder.color}`} key={folder.id}><button type="button" className="folder-open" onClick={() => onOpen(folder.id)} aria-label={`Open ${folder.name}, ${count} ${count === 1 ? 'document' : 'documents'}`}><FolderGlyph color={folder.color} /><strong>{folder.name}</strong><span>{count} {count === 1 ? 'document' : 'documents'}<ArrowUpRight size={15} /></span></button><FolderMenu folder={folder} onRename={() => onRename(folder)} onDelete={() => onDelete(folder)} /></div>;
  })}</div></section>;
}

function DocumentCard({ doc, folder, onOpen }: { doc: ScanDocument; folder?: Folder; onOpen: () => void }) {
  const url = useObjectUrl(doc.thumbnail);
  return <button type="button" className="document-card" onClick={onOpen} aria-label={`Open document ${doc.name}`}><div className="document-cover">{url && <img src={url} alt={`First page of ${doc.name}`} loading="lazy" />}<span className="document-page-count"><FileText size={12} />{doc.pageIds.length} {doc.pageIds.length === 1 ? 'page' : 'pages'}</span></div><div className="document-card-info"><h3 title={doc.name}>{doc.name}</h3><time dateTime={doc.createdAt}>{formatDate(doc.createdAt)}</time>{folder && <span className="document-folder-label"><FolderIcon size={12} />{folder.name}</span>}</div></button>;
}

export function DocumentSection({ documents, folders, query, inFolder, onOpen, onClearSearch, onScan }: { documents: ScanDocument[]; folders: Folder[]; query: string; inFolder: boolean; onOpen: (doc: ScanDocument) => void; onClearSearch: () => void; onScan: () => void }) {
  return <section className="documents-section"><div className="section-heading"><h2>{query ? 'Search results' : inFolder ? 'Documents' : 'Recent documents'} <span className="count-badge">{documents.length}</span></h2>{documents.length > 0 && <span className="sort-label">Newest first</span>}</div>{query && <p className="search-summary">{documents.length} {documents.length === 1 ? 'match' : 'matches'} for <strong>“{query}”</strong> across all folders</p>}
    {documents.length > 0 ? <div className="document-grid">{documents.map(doc => <DocumentCard key={doc.id} doc={doc} folder={!inFolder ? folders.find(f => f.id === doc.folderId) : undefined} onOpen={() => onOpen(doc)} />)}</div> : <div className={`empty-documents ${inFolder || query ? 'expanded' : ''}`}>{query ? <div className="empty-search-icon"><SearchX size={28} /></div> : <EmptyDocumentsIllustration />}<div><h3>{query ? 'No documents found' : inFolder ? 'A little room for what matters.' : 'Your next clear beginning.'}</h3><p>{query ? 'Try another name. Search looks through every folder on this device.' : inFolder ? 'This folder is ready. Scan a document to make it feel at home.' : 'Your scans will appear here, neatly filed and easy to find.'}</p>{query ? <Button variant="ghost" onClick={onClearSearch}>Clear search</Button> : inFolder ? <Button variant="ghost" onClick={onScan}><Plus size={16} />Scan into this folder</Button> : <span className="empty-note">A little less clutter starts with one scan.</span>}</div></div>}
  </section>;
}
