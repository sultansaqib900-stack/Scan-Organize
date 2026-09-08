'use client';

import { AlertCircle, Check, FolderPlus, LoaderCircle, Pencil, Trash2, X } from 'lucide-react';
import { ButtonHTMLAttributes, FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_NAME_LENGTH, readableError } from '@/lib/model';

export function Button({ children, className = '', variant = 'primary', busy = false, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button className={`button button-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{busy && <LoaderCircle size={18} className="spin" />}{children}</button>;
}

export function IconButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`icon-button ${className}`} type="button" {...props}>{children}</button>;
}

export function Modal({ children, title, onClose, fullScreen = false, busy = false, className = '' }: { children: ReactNode; title: string; onClose: () => void; fullScreen?: boolean; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} className={`${fullScreen ? 'full-screen-dialog' : 'modal'} ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => {
    if (busy || fullScreen || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>{children}</dialog>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <div className="error-message" role="alert"><AlertCircle size={19} /><span>{children}</span></div>;
}

export function NameDialog({ title, description, initialValue = '', label, confirmLabel, onSubmit, onClose }: { title: string; description: string; initialValue?: string; label: string; confirmLabel: string; onSubmit: (name: string) => void | Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onSubmit(name); onClose(); } catch (err) { setError(readableError(err)); setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} busy={busy}>
    <div className="modal-heading"><div className="modal-symbol">{title.startsWith('Rename') ? <Pencil size={24} /> : <FolderPlus size={25} />}</div><IconButton aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={20} /></IconButton></div>
    <h2>{title}</h2><p className="modal-description">{description}</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="text-input" value={name} onChange={event => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} autoFocus onFocus={event => event.target.select()} required disabled={busy} autoComplete="off" />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={!name.trim()}>{confirmLabel}</Button></div>
    </form>
  </Modal>;
}

export function ConfirmDialog({ title, description, confirmLabel = 'Delete', onConfirm, onClose }: { title: string; description: ReactNode; confirmLabel?: string; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title={title} onClose={onClose} busy={busy}>
    <div className="modal-heading"><div className="modal-symbol danger"><Trash2 size={24} /></div><IconButton aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={20} /></IconButton></div>
    <h2>{title}</h2><div className="modal-description">{description}</div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className="modal-actions"><Button variant="secondary" onClick={onClose} disabled={busy} autoFocus>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(); onClose(); } catch (err) { setError(readableError(err)); setBusy(false); } }}>{confirmLabel}</Button></div>
  </Modal>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Keep notifications above the HTML dialog top layer without stealing focus.
    const attach = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
      const target = dialogs.at(-1) || document.body;
      setContainer(previous => previous === target ? previous : target);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    const timer = setTimeout(onClose, 5500);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [message, onClose]);
  return container ? createPortal(<div className="toast" role="status"><span className="toast-check"><Check size={16} /></span><span>{message}</span><IconButton aria-label="Dismiss notification" onClick={onClose}><X size={17} /></IconButton></div>, container) : null;
}
