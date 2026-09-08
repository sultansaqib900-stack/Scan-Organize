'use client';

import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, FileText, GripVertical, LockKeyhole, Plus, RotateCcw, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { DraftPage, Folder, MAX_NAME_LENGTH, MAX_PAGES, readableError } from '@/lib/model';
import { useObjectUrl } from '@/lib/hooks';
import { Button, ErrorMessage } from './ui';
import { EmptyDocumentsIllustration } from './illustrations';

function DraftThumbnail({ page, index, active, disabled, onSelect, onDelete }: { page: DraftPage; index: number; active: boolean; disabled: boolean; onSelect: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled });
  const url = useObjectUrl(page.image);
  return <div ref={setNodeRef} className={`draft-thumbnail ${active ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} data-page-id={page.id}>
    <button className="draft-thumbnail-image" type="button" onClick={onSelect} aria-label={`Preview page ${index + 1}`} aria-pressed={active} disabled={disabled}>{url && <img src={url} alt={`Page ${index + 1}`} draggable={false} />}</button>
    <button type="button" className="page-remove" aria-label={`Delete page ${index + 1}`} onClick={onDelete} disabled={disabled}><X size={14} /></button>
    <div className="draft-thumbnail-footer"><span>{String(index + 1).padStart(2, '0')}</span><button type="button" className="drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder page ${index + 1}`} disabled={disabled}><GripVertical size={17} /></button></div>
  </div>;
}

function PagePreview({ page }: { page: DraftPage }) {
  const url = useObjectUrl(page.image);
  return url ? <img src={url} alt="Selected scanned page" draggable={false} /> : null;
}

export function PageReview({ pages, folders, initialFolder, initialName, initialPageId, onPagesChange, onAdd, onRetake, onSave, onBusyChange }: { pages: DraftPage[]; folders: Folder[]; initialFolder: string; initialName: string; initialPageId?: string; onRetake: (pageId: string, name: string, folder: string) => void; onPagesChange: (pages: DraftPage[]) => void; onAdd: (name: string, folder: string) => void; onSave: (name: string, folder: string) => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [name, setName] = useState(initialName);
  const [folderId, setFolderId] = useState(initialFolder);
  const [selectedId, setSelectedId] = useState(initialPageId || pages.at(-1)?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [liveRegionContainer, setLiveRegionContainer] = useState<HTMLDivElement | null>(null);
  const selected = pages.find(p => p.id === selectedId) || pages[0];
  const selectedIndex = pages.findIndex(p => p.id === selected?.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = pages.findIndex(p => p.id === event.active.id), to = pages.findIndex(p => p.id === event.over?.id);
    if (from >= 0 && to >= 0) onPagesChange(arrayMove(pages, from, to));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true); onBusyChange(true);
    try { await onSave(name, folderId); } catch (err) { setError(readableError(err)); } finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="review-layout" ref={setLiveRegionContainer}>
    <section className="review-preview"><div className="preview-heading"><span><FileText size={16} /> Document preview</span>{selected && <div className="preview-page-actions"><span>Page {selectedIndex + 1} of {pages.length}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => onRetake(selected.id, name, folderId)}><RotateCcw size={14} />Retake page</Button></div>}</div><div className="review-paper">{selected ? <PagePreview page={selected} /> : <div className="no-draft"><EmptyDocumentsIllustration /><h3>A fresh page awaits</h3><p>Add a page to start your document.</p></div>}</div><p className="preview-footnote">Your clean scan, ready for a place of its own.</p></section>
    <form className="review-details" onSubmit={save}>
      <div className="review-title"><span className="eyebrow">LOOKING GOOD</span><h2>Make it official.</h2><p>Name it, file it, and you’re all set.</p></div>
      <div className="field"><label className="field-label" htmlFor="document-name">Document name</label><input className="text-input" id="document-name" value={name} onChange={event => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} required disabled={busy} autoComplete="off" /></div>
      <div className="field"><label className="field-label" htmlFor="document-folder">Save in folder</label><div className="select-wrap"><select className="text-input" id="document-folder" value={folderId} onChange={event => setFolderId(event.target.value)} disabled={busy}>{folders.map(folder => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><ChevronDown size={17} /></div></div>
      <div className="review-pages-heading"><h3>Pages <span className="count-badge">{pages.length}</span></h3><span>{pages.length} / {MAX_PAGES}</span></div>
      <p className="field-hint">Drag the handles to reorder. Tap × to remove.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder} accessibility={{
        container: liveRegionContainer || undefined,
        screenReaderInstructions: { draggable: 'Press space to pick up a page. Use arrow keys to reorder, space to drop, or Escape to cancel.' },
        announcements: {
          onDragStart: ({ active }) => `Picked up page ${pages.findIndex(p => p.id === active.id) + 1}.`,
          onDragOver: ({ active, over }) => over ? `Moving page ${pages.findIndex(p => p.id === active.id) + 1} to position ${pages.findIndex(p => p.id === over.id) + 1}.` : 'Move over another page to reorder.',
          onDragEnd: ({ over }) => over ? `Page placed at position ${pages.findIndex(p => p.id === over.id) + 1}.` : 'Page order unchanged.',
          onDragCancel: () => 'Reordering cancelled.',
        },
      }}><SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}><div className="draft-page-list">{pages.map((page, index) => <DraftThumbnail key={page.id} page={page} index={index} active={selected?.id === page.id} disabled={busy} onSelect={() => setSelectedId(page.id)} onDelete={() => onPagesChange(pages.filter(p => p.id !== page.id))} />)}</div></SortableContext></DndContext>
      <Button type="button" variant="secondary" className="add-page-button" onClick={() => onAdd(name, folderId)} disabled={busy || pages.length >= MAX_PAGES}><Plus size={18} />Add a page</Button>
      {pages.length >= MAX_PAGES && <p className="field-hint">This document is full. Save it and start another to add more pages.</p>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="review-save"><Button type="submit" className="save-document-button" busy={busy} disabled={!pages.length || !name.trim()}>{!busy && <Check size={18} />}Save document</Button><p className="privacy-caption"><LockKeyhole size={13} /> Saved only on this device</p></div>
    </form>
  </div>;
}
