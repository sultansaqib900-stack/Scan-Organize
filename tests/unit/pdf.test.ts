import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPdf, pdfFilename } from '@/lib/pdf';
import { ScanPage } from '@/lib/model';

describe('client-side PDF', () => {
  it('builds one real PDF page for each scan, preserving portrait/landscape orientation', async () => {
    const fixture = await readFile('tests/fixtures/page-a.jpg');
    const image = new Blob([fixture], { type: 'image/jpeg' });
    const pages: ScanPage[] = [
      { id: 'one', documentId: 'doc', image, width: 600, height: 800 },
      { id: 'two', documentId: 'doc', image, width: 800, height: 600 },
    ];
    const blob = await buildPdf({ name: 'Offline paperwork' }, pages);
    const bytes = await blob.arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2); expect(pdf.getTitle()).toBe('Offline paperwork');
    const [first, second] = pdf.getPages();
    expect(first.getHeight()).toBeGreaterThan(first.getWidth()); expect(second.getWidth()).toBeGreaterThan(second.getHeight());
  });
  it('rejects exporting a document without pages', async () => {
    await expect(buildPdf({ name: 'Empty' }, [])).rejects.toThrow('no pages');
  });
  it('makes safe native filenames without duplicate extensions or path traversal', () => {
    expect(pdfFilename('Tax / 2026: final?')).toBe('Tax - 2026- final-.pdf');
    expect(pdfFilename('receipt.PDF')).toBe('receipt.pdf');
    expect(pdfFilename('   ')).toBe('Document.pdf');
    expect(pdfFilename('..')).toBe('Document.pdf');
    expect(pdfFilename('../folder\\bad\u0000')).not.toContain('/');
    expect(pdfFilename('x'.repeat(200)).length).toBeLessThanOrEqual(94);
  });
});
