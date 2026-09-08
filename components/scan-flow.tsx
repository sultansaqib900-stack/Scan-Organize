'use client';

import { Check, ChevronRight, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { defaultDocumentName, DraftPage, Folder } from '@/lib/model';
import { CapturedImage, makeThumbnail } from '@/lib/image-processing';
import { CameraCapture } from './camera-capture';
import { CornerEditor } from './corner-editor';
import { PageReview } from './page-review';
import { ConfirmDialog, IconButton, Modal } from './ui';

type Stage = 'capture' | 'crop' | 'review';

export function ScanFlow({ folders, initialFolder, onClose, onSave }: { folders: Folder[]; initialFolder: string; onClose: () => void; onSave: (name: string, folderId: string, pages: DraftPage[], thumbnail: Blob) => Promise<void> }) {
  const [stage, setStage] = useState<Stage>('capture');
  const [capture, setCapture] = useState<CapturedImage | null>(null);
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [name, setName] = useState(defaultDocumentName);
  const [replacePageId, setReplacePageId] = useState<string | null>(null);
  const [reviewPageId, setReviewPageId] = useState<string>();
  const [folderId, setFolderId] = useState(initialFolder);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = pages.length > 0 || capture !== null;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const close = useCallback(() => { if (busy) return; if (dirty) setDiscardOpen(true); else onClose(); }, [busy, dirty, onClose]);
  const receiveCapture = useCallback((image: CapturedImage) => { setCapture(image); setStage('crop'); }, []);
  const currentStep = stage === 'capture' ? 0 : stage === 'crop' ? 1 : 2;
  return <>
    <Modal title="Scan a document" fullScreen onClose={close} busy={busy} className="scanner-dialog">
      <header className="scan-header"><div className="scan-header-title"><span className="mini-brand"><ScanLine size={23} /></span><div><strong>Scan a document</strong><span>{stage === 'review' ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} · not saved yet` : replacePageId ? `Retaking page ${pages.findIndex(p => p.id === replacePageId) + 1}` : `Page ${pages.length + 1}`}</span></div></div><div className="scan-steps" aria-label={`Step ${currentStep + 1} of 3`}>{['Capture', 'Adjust', 'Review'].map((label, index) => <span className={index === currentStep ? 'current' : index < currentStep ? 'complete' : ''} key={label}><i>{index < currentStep ? <Check size={12} /> : index + 1}</i>{label}{index < 2 && <ChevronRight size={14} />}</span>)}</div><IconButton aria-label="Close scanner" onClick={close} disabled={busy}><X size={23} /></IconButton></header>
      <div className="scan-content">
        {stage === 'capture' && <CameraCapture pageCount={pages.length} onCapture={receiveCapture} onReview={() => { setReplacePageId(null); setStage('review'); }} />}
        {stage === 'crop' && capture && <CornerEditor capture={capture} onBusyChange={setBusy} onRetake={() => { setCapture(null); setStage('capture'); }} onDone={page => { setPages(previous => replacePageId ? previous.map(p => p.id === replacePageId ? page : p) : [...previous, page]); setReviewPageId(page.id); setReplacePageId(null); setCapture(null); setStage('review'); }} />}
        {stage === 'review' && <PageReview pages={pages} folders={folders} initialFolder={folderId} initialName={name} initialPageId={reviewPageId} onRetake={(pageId, draftName, draftFolder) => { setReplacePageId(pageId); setName(draftName); setFolderId(draftFolder); setStage('capture'); }} onBusyChange={setBusy} onPagesChange={setPages} onAdd={(draftName, draftFolder) => { setReplacePageId(null); setName(draftName); setFolderId(draftFolder); setStage('capture'); }} onSave={async (documentName, destination) => { const thumbnail = await makeThumbnail(pages[0].image); await onSave(documentName, destination, pages, thumbnail); }} />}
      </div>
    </Modal>
    {discardOpen && <ConfirmDialog title="Discard this scan?" description="These pages haven’t been saved. If you leave now, you’ll need to scan them again." confirmLabel="Discard scan" onConfirm={onClose} onClose={() => setDiscardOpen(false)} />}
  </>;
}
