export const DEFAULT_FOLDER_ID = 'unfiled';
export const MAX_NAME_LENGTH = 100;
export const MAX_IMAGE_EDGE = 2200;
export const MAX_PAGES = 40; // Bounded memory use on Android WebViews.

export type FolderColor = 'sage' | 'sand' | 'blue' | 'lavender';
export interface Folder {
  id: string;
  name: string;
  color: FolderColor;
  createdAt: string;
}
export interface ScanDocument {
  id: string;
  name: string;
  folderId: string;
  createdAt: string;
  updatedAt: string;
  pageIds: string[];
  thumbnail: Blob;
}
export interface ScanPage {
  id: string;
  documentId: string;
  image: Blob;
  width: number;
  height: number;
}
export type DraftPage = Omit<ScanPage, 'documentId'>;
export interface Point { x: number; y: number }
// Clockwise: top-left, top-right, bottom-right, bottom-left.
export type Quad = [Point, Point, Point, Point];
export type ScanFilter = 'color' | 'bw';

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

export function cleanName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) throw new Error('Please enter a name.');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`);
  return name;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function defaultDocumentName(): string {
  return `Scan ${formatDate(new Date().toISOString())}`;
}

export function readableError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
    return 'Your device is low on storage. Free up some space and try again. Your saved documents are unchanged.';
  }
  if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'InvalidStateError')) {
    return 'On-device storage is unavailable. Allow site storage in your browser, or reopen the Android app. Nothing has been saved.';
  }
  return error instanceof Error ? error.message : fallback;
}
