'use client';

import { Camera, CameraOff, ImagePlus, Layers2, LoaderCircle, LockKeyhole, RefreshCw, ScanLine } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { captureFrame, CapturedImage, normalizePhoto } from '@/lib/image-processing';
import { cameraError, requestCameraAccess } from '@/lib/native';
import { readableError } from '@/lib/model';
import { Button, ErrorMessage } from './ui';

type CameraStatus = 'requesting' | 'live' | 'error' | 'paused';

export function CameraCapture({ pageCount, onCapture, onReview }: { pageCount: number; onCapture: (image: CapturedImage) => void; onReview: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('requesting');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    const current = ++generation.current;
    stop(); setError(''); setStatus('requesting');
    try {
      await requestCameraAccess();
      if (current !== generation.current) return;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs a secure browser (HTTPS or localhost) or the Android app. You can still choose a photo.');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 2560 } } });
      } catch (err) {
        if (err instanceof Error && err.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
        else throw err;
      }
      if (current !== generation.current || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      stream.getVideoTracks().forEach(track => { track.onended = () => { if (current === generation.current) { stop(); setStatus('paused'); } }; });
      const video = videoRef.current;
      if (video) { video.srcObject = stream; await video.play(); }
    } catch (err) {
      if (current !== generation.current) return;
      stop(); setError(cameraError(err)); setStatus('error');
    }
  }, [stop]);

  const invalidate = useCallback(() => { generation.current++; stop(); }, [stop]);

  useEffect(() => {
    // Camera initialization subscribes to an external device and exposes its status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    const pause = () => { generation.current++; stop(); setStatus('paused'); };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    let disposed = false;
    let removeNativeListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', state => { if (!state.isActive) pause(); })).then(handle => {
        if (disposed) void handle.remove(); else removeNativeListener = () => { void handle.remove(); };
      }).catch(() => { /* document.visibilitychange is the WebView fallback. */ });
    }
    return () => { disposed = true; invalidate(); document.removeEventListener('visibilitychange', visibility); removeNativeListener?.(); };
  }, [start, stop, invalidate]);

  async function takePhoto() {
    if (!videoRef.current || busy || status !== 'live') return;
    setBusy(true); setError('');
    try { onCapture(await captureFrame(videoRef.current)); } catch (err) { setError(readableError(err)); setBusy(false); }
  }

  return <div className="capture-layout">
    <div className="scan-instructions"><span className="eyebrow">ONE PAGE AT A TIME</span><h2>A little focus. A clean scan.</h2><p>Place your document on a flat surface with good lighting.</p></div>
    <div className={`camera-window ${status !== 'live' ? 'camera-inactive' : ''}`}>
      <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" onLoadedData={() => { if (streamRef.current) setStatus('live'); }} />
      {status === 'live' && <><div className="viewfinder"><i /><i /><i /><i /></div><span className="camera-hint"><ScanLine size={16} /> Keep the whole page in view</span></>}
      {status !== 'live' && <div className="camera-placeholder">
        <div className="camera-placeholder-icon">{status === 'requesting' ? <LoaderCircle size={32} className="spin" /> : status === 'error' ? <CameraOff size={32} /> : <Camera size={32} />}</div>
        <h3>{status === 'requesting' ? 'Getting your camera ready…' : status === 'paused' ? 'Camera paused' : 'Let’s find another way to scan'}</h3>
        <p>{status === 'requesting' ? 'Allow camera access when your device asks. Your camera is only used while scanning.' : status === 'paused' ? 'Your camera was stopped while the app was in the background. Resume whenever you’re ready.' : error}</p>
        {status !== 'requesting' && <Button variant="secondary" onClick={() => void start()}><RefreshCw size={17} />{status === 'paused' ? 'Resume camera' : 'Try camera again'}</Button>}
      </div>}
    </div>
    {error && status !== 'error' && <ErrorMessage>{error}</ErrorMessage>}
    <div className="camera-controls">
      <button type="button" className="capture-side-button" onClick={() => inputRef.current?.click()} disabled={busy}><ImagePlus size={23} /><span>Choose a photo</span></button>
      <button type="button" className="shutter-button" aria-label="Capture page" onClick={() => void takePhoto()} disabled={status !== 'live' || busy}>{busy ? <LoaderCircle className="spin" size={27} /> : <span />}</button>
      <button type="button" className="capture-side-button" disabled={!pageCount || busy} onClick={onReview}><Layers2 size={23} /><span>Pages{pageCount > 0 ? ` (${pageCount})` : ''}</span></button>
    </div>
    <p className="privacy-caption"><LockKeyhole size={13} /> Your photos never leave this device.</p>
    <input ref={inputRef} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-label="Choose a document photo" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      setBusy(true); setError('');
      try { const image = await normalizePhoto(file); onCapture(image); } catch (err) { setError(readableError(err)); } finally { setBusy(false); }
    }} />
  </div>;
}
