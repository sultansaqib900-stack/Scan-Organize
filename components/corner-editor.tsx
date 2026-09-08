'use client';

import { ArrowLeft, ArrowRight, Check, Contrast, LoaderCircle, Palette, RotateCcw } from 'lucide-react';
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import { CapturedImage, initialCorners, isValidQuad, processScan } from '@/lib/image-processing';
import { DraftPage, Quad, readableError, ScanFilter } from '@/lib/model';
import { useObjectUrl } from '@/lib/hooks';
import { Button, ErrorMessage } from './ui';

const cornerNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

export function CornerEditor({ capture, onRetake, onDone, onBusyChange }: { capture: CapturedImage; onRetake: () => void; onDone: (page: DraftPage) => void; onBusyChange: (busy: boolean) => void }) {
  const [corners, setCorners] = useState<Quad>(initialCorners);
  const [filter, setFilter] = useState<ScanFilter>('color');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 600, height: 600 });
  const imageUrl = useObjectUrl(capture.image);
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setBounds({ width, height }); });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);
  const ratio = capture.width / capture.height;
  const width = Math.max(1, Math.min(bounds.width, bounds.height * ratio));
  const height = width / ratio;

  function moveCorner(index: number, x: number, y: number) {
    setCorners(previous => {
      const next = previous.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p) as Quad;
      return isValidQuad(next) ? next : previous;
    });
  }
  function drag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || busy) return;
    const rect = imageRef.current?.getBoundingClientRect();
    if (rect) moveCorner(index, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  function nudge(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.shiftKey ? 0.002 : 0.01;
    moveCorner(index, corners[index].x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), corners[index].y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0));
  }
  async function apply() {
    setBusy(true); onBusyChange(true); setError('');
    try { onDone(await processScan(capture, corners, filter)); } catch (err) { setError(readableError(err)); } finally { setBusy(false); onBusyChange(false); }
  }
  const polygon = corners.map(p => `${p.x * 100},${p.y * 100}`).join(' ');
  const cutout = `M0,0H100V100H0Z M${corners.map(p => `${p.x * 100},${p.y * 100}`).join('L')}Z`;
  return <div className="crop-layout">
    <div className="scan-instructions"><span className="eyebrow">JUST THE IMPORTANT PART</span><h2>Give it a clean edge.</h2><p>Drag the four corners to the edges of your document.</p></div>
    <div className="crop-stage-wrap"><div className="crop-stage" ref={stageRef}>
      <div className="crop-image" ref={imageRef} style={{ width, height }}>
        {imageUrl && <img src={imageUrl} alt="Captured document with adjustable crop corners" draggable={false} />}
        <svg className="crop-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={cutout} fill="rgba(13,30,23,.57)" fillRule="evenodd" /><polygon points={polygon} fill="none" stroke="#a9efb5" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
        {corners.map((point, index) => <button key={index} type="button" className="crop-handle" aria-label={`${cornerNames[index]} crop corner`} title="Drag, or use arrow keys. Hold Shift for fine adjustment." style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} disabled={busy} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => drag(event, index)} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={event => nudge(event, index)}><span /></button>)}
      </div>
    </div>{busy && <div className="processing-overlay" role="status"><LoaderCircle size={32} className="spin" /><strong>Making a cleaner page…</strong><span>Everything is processed on your device.</span></div>}</div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className="crop-tools"><div className="filter-options" role="radiogroup" aria-label="Scan filter"><button type="button" role="radio" aria-checked={filter === 'color'} className={filter === 'color' ? 'selected' : ''} onClick={() => setFilter('color')} disabled={busy}><Palette size={17} /> Clean color {filter === 'color' && <Check size={14} />}</button><button type="button" role="radio" aria-checked={filter === 'bw'} className={filter === 'bw' ? 'selected' : ''} onClick={() => setFilter('bw')} disabled={busy}><Contrast size={17} /> Black & white {filter === 'bw' && <Check size={14} />}</button></div><Button variant="ghost" onClick={() => setCorners(initialCorners())} disabled={busy}><RotateCcw size={16} />Reset corners</Button></div>
    <div className="scan-bottom-actions"><Button variant="secondary" onClick={onRetake} disabled={busy}><ArrowLeft size={17} />Retake photo</Button><Button onClick={() => void apply()} busy={busy}>Use this page {!busy && <ArrowRight size={17} />}</Button></div>
  </div>;
}
