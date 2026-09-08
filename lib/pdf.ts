import { Capacitor } from '@capacitor/core';
import { ScanDocument, ScanPage } from './model';
import { savePdfNatively, writePdfToCache } from './native-pdf';

export function pdfFilename(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').trim().replace(/\.pdf$/i, '').slice(0, 90).trim();
  return `${safe || 'Document'}.pdf`;
}

export async function buildPdf(doc: Pick<ScanDocument, 'name'>, pages: ScanPage[]): Promise<Blob> {
  if (!pages.length) throw new Error('This document has no pages to export.');
  const { jsPDF } = await import('jspdf');
  const orientation = (page: ScanPage) => page.width > page.height ? 'landscape' as const : 'portrait' as const;
  const pdf = new jsPDF({ orientation: orientation(pages[0]), unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: doc.name, creator: 'Scan & Organize' });
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (i > 0) pdf.addPage('a4', orientation(page));
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const scale = Math.min((pageWidth - 16) / page.width, (pageHeight - 16) / page.height);
    const width = page.width * scale, height = page.height * scale;
    const bytes = new Uint8Array(await page.image.arrayBuffer());
    pdf.addImage(bytes, 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, `page-${i}`, 'FAST');
  }
  return pdf.output('blob');
}

export type ExportResult = 'saved' | 'native' | 'shared' | 'downloaded' | 'cancelled';

export async function exportAsPdf(doc: ScanDocument, pages: ScanPage[]): Promise<ExportResult> {
  const blob = await buildPdf(doc, pages);
  const name = pdfFilename(doc.name);
  if (Capacitor.isNativePlatform()) {
    // NEVER use an anchor/download fallback inside a WebView. Android cannot
    // reliably save blob: URLs, and the user expects the system share sheet.
    const canSave = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PdfSave');
    const canShare = Capacitor.isPluginAvailable('Share');
    if (!Capacitor.isPluginAvailable('Filesystem') || (!canSave && !canShare)) {
      throw new Error('Native PDF sharing is unavailable. Run npm run amazon:sync and rebuild the Fire tablet app. Your document is still safely saved.');
    }
    const uri = await writePdfToCache(blob, name);
    // Prefer the system's local Save dialog on Fire tablets. This does not need
    // Google Drive, a PDF viewer, or an installed third-party share destination.
    const saveResult = await savePdfNatively(uri, name);
    if (saveResult === 'saved' || saveResult === 'cancelled') return saveResult;
    // Fall back only when a system picker is unavailable, NEVER on user cancel
    // or a disk/permission failure. Both paths remain fully native.
    if (!canShare) throw new Error('No native PDF save or share option is available on this device. Your document is still saved.');
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title: doc.name, files: [uri], dialogTitle: 'Export as PDF' });
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return 'cancelled';
      throw error;
    }
    // Retain the private cached file: recipients may read it after Share resolves.
    // Android can clear this cache; no shared-storage permission is necessary.
    return 'native';
  }
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: doc.name, files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      // Desktop/browser previews may lose transient activation while generating
      // a PDF. Only the non-native preview is allowed to use a download fallback.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
