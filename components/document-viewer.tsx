'use client';

import { ArrowLeft, ChevronLeft, ChevronRight, FileDown, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Folder, formatDate, readableError, ScanDocument, ScanPage } from '@/lib/model';
import { getPages } from '@/lib/storage';
import { exportAsPdf } from '@/lib/pdf';
import { useObjectUrl } from '@/lib/hooks';
import { Button, ErrorMessage, IconButton, Modal } from './ui';

function PageImage({ page, alt }: { page: ScanPage; alt: string }) {
  const url = useObjectUrl(page.image);
  return url ? <img src={url} alt={alt} draggable={false} /> : null;
}

export function DocumentViewer({ doc, folder, onClose, onRename, onDelete, notify }: { doc: ScanDocument; folder: Folder | undefined; onClose: () => void; onRename: () => void; onDelete: () => void; notify: (message: string) => void }) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [current, setCurrent] = useState(0);
  const carousel = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getPages(doc).then(result => { if (!cancelled) { setPages(result); setError(''); } }).catch(err => { if (!cancelled) setError(readableError(err)); });
    return () => { cancelled = true; };
  }, [doc, loadAttempt]);
  useEffect(() => {
    const element = carousel.current;
    if (!element) return;
    const resize = new ResizeObserver(() => { element.scrollLeft = indexRef.current * element.clientWidth; });
    resize.observe(element);
    return () => resize.disconnect();
  }, [pages.length]);
  function goTo(index: number) {
    if (index < 0 || index >= pages.length) return;
    const element = carousel.current;
    element?.scrollTo({ left: element.clientWidth * index, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  async function exportPdf() {
    setExporting(true); setExportError('');
    try {
      const result = await exportAsPdf(doc, pages);
      if (result === 'downloaded') notify('PDF downloaded for browser preview. The Fire tablet app uses native save/share.');
      else if (result === 'saved') notify('PDF saved to the location you chose.');
      else if (result !== 'cancelled') notify(result === 'native' ? 'Your PDF was opened in the native share sheet.' : 'Your PDF is ready to share.');
    } catch (err) { setExportError(readableError(err, 'The PDF could not be exported. Your document is still saved. Please try again.')); } finally { setExporting(false); }
  }
  return <Modal title={doc.name} fullScreen onClose={onClose} busy={exporting} className="viewer-dialog"><div className="viewer-shell" onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); goTo(current + 1); } else if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(current - 1); } }}>
    <header className="viewer-header"><IconButton aria-label="Close document" onClick={onClose} disabled={exporting}><ArrowLeft size={22} /></IconButton><div className="viewer-document-title"><h1>{doc.name}</h1><p>{folder?.name || 'Unfiled'} <span>·</span> {formatDate(doc.createdAt)} <span>·</span> {doc.pageIds.length} {doc.pageIds.length === 1 ? 'page' : 'pages'}</p></div><div className="viewer-document-actions"><IconButton aria-label="Rename document" title="Rename document" onClick={onRename} disabled={exporting}><Pencil size={19} /></IconButton><IconButton aria-label="Delete document" title="Delete document" onClick={onDelete} disabled={exporting} className="delete-action"><Trash2 size={19} /></IconButton></div></header>
    <div className="viewer-stage">
      {error ? <div className="viewer-error"><ErrorMessage>{error}</ErrorMessage><Button variant="secondary" onClick={() => setLoadAttempt(n => n + 1)}>Try loading again</Button></div> : !pages.length ? <div className="loading-state" role="status"><LoaderCircle size={27} className="spin" /><span>Opening your document…</span></div> : <>
        <div className="page-carousel" ref={carousel} aria-label="Document pages; swipe left or right" onScroll={event => { const element = event.currentTarget; if (element.clientWidth) { const index = Math.max(0, Math.min(pages.length - 1, Math.round(element.scrollLeft / element.clientWidth))); indexRef.current = index; setCurrent(index); } }}>{pages.map((page, index) => <div className="viewer-page" key={page.id} aria-label={`Page ${index + 1}`} aria-hidden={index !== current}><PageImage page={page} alt={`Page ${index + 1} of ${doc.name}`} /></div>)}</div>
        {pages.length > 1 && <><IconButton className="viewer-arrow previous" aria-label="Previous page" onClick={() => goTo(current - 1)} disabled={current === 0}><ChevronLeft size={26} /></IconButton><IconButton className="viewer-arrow next" aria-label="Next page" onClick={() => goTo(current + 1)} disabled={current === pages.length - 1}><ChevronRight size={26} /></IconButton></>}
      </>}
    </div>
    {pages.length > 1 && <div className="viewer-thumbnails">{pages.map((page, index) => <button type="button" key={page.id} className={index === current ? 'selected' : ''} onClick={() => goTo(index)} aria-label={`Go to page ${index + 1}`} aria-current={index === current ? 'page' : undefined}><PageImage page={page} alt="" /><span>{index + 1}</span></button>)}</div>}
    {exportError && <div className="viewer-export-error"><ErrorMessage>{exportError}</ErrorMessage></div>}
    <footer className="viewer-footer"><div><strong aria-live="polite">{pages.length ? `Page ${current + 1} of ${pages.length}` : 'Document preview'}</strong><span>{pages.length > 1 ? 'Swipe to turn the page' : 'Safely stored on your device'}</span></div><Button onClick={() => void exportPdf()} busy={exporting} disabled={!pages.length || Boolean(error)}>{!exporting && <FileDown size={18} />} {exporting ? 'Preparing PDF…' : 'Export as PDF'}</Button></footer>
  </div></Modal>;
}
