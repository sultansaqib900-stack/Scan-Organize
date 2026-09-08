import { readFile } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ScanDocument, ScanPage } from '@/lib/model';

const mocks = vi.hoisted(() => ({
  platform: 'android', available: true, saveAvailable: false, shareAvailable: true,
  permission: vi.fn(), write: vi.fn(), append: vi.fn(), remove: vi.fn(), share: vi.fn(), save: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    isNativePlatform: () => mocks.platform !== 'web',
    isPluginAvailable: (name: string) => mocks.available && (name === 'PdfSave' ? mocks.saveAvailable : name === 'Share' ? mocks.shareAvailable : true),
  },
  registerPlugin: (name: string) => name === 'PdfSave' ? { save: mocks.save } : { request: mocks.permission },
}));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: mocks.write, appendFile: mocks.append, deleteFile: mocks.remove }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));
import { cameraError, requestCameraAccess } from '@/lib/native';
import { exportAsPdf } from '@/lib/pdf';
import { NATIVE_PDF_CHUNK_BYTES, savePdfNatively, writePdfToCache } from '@/lib/native-pdf';

beforeEach(() => {
  mocks.platform = 'android'; mocks.available = true; mocks.saveAvailable = false; mocks.shareAvailable = true;
  mocks.permission.mockResolvedValue({ state: 'granted' });
  mocks.write.mockResolvedValue({ uri: 'file:///data/user/0/app/cache/exports/test.pdf' });
  mocks.append.mockResolvedValue({}); mocks.remove.mockResolvedValue({});
  mocks.share.mockResolvedValue({ activityType: 'android' });
  mocks.save.mockResolvedValue({ status: 'saved' });
  vi.stubGlobal('FileReader', class {
    result = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    async readAsDataURL(blob: Blob) { this.result = `data:application/pdf;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const image = new Blob([await readFile('tests/fixtures/page-a.jpg')], { type: 'image/jpeg' });
  const doc: ScanDocument = { id: 'doc', name: 'Native scan', folderId: 'unfiled', pageIds: ['one'], thumbnail: image, createdAt: '', updatedAt: '' };
  const pages: ScanPage[] = [{ id: 'one', documentId: 'doc', image, width: 600, height: 800 }];
  return { doc, pages };
}

describe('Fire OS / Android API paths', () => {
  it('requests native camera permission before getUserMedia', async () => {
    await requestCameraAccess(); expect(mocks.permission).toHaveBeenCalledOnce();
    mocks.permission.mockResolvedValue({ state: 'denied' });
    await expect(requestCameraAccess()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
  it('does not request an Android permission in the browser', async () => {
    mocks.platform = 'web'; await requestCameraAccess(); expect(mocks.permission).not.toHaveBeenCalled();
  });
  it('explains missing native camera registration and common camera failures', async () => {
    mocks.available = false;
    await expect(requestCameraAccess()).rejects.toThrow('camera bridge is missing');
    expect(cameraError(new DOMException('', 'NotAllowedError'))).toContain('settings');
    expect(cameraError(new DOMException('', 'NotFoundError'))).toContain('No camera');
    expect(cameraError(new DOMException('', 'NotReadableError'))).toContain('busy');
  });
  it('writes a base64 PDF to private CACHE and invokes native Share when no picker bridge exists', async () => {
    const { doc, pages } = await fixture();
    expect(await exportAsPdf(doc, pages)).toBe('native');
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', recursive: true, path: expect.stringMatching(/^exports\/\d+-Native scan\.pdf$/) }));
    expect(Buffer.from(mocks.write.mock.calls[0][0].data, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(mocks.share).toHaveBeenCalledWith({ title: 'Native scan', dialogTitle: 'Export as PDF', files: ['file:///data/user/0/app/cache/exports/test.pdf'] });
  });
  it('never falls back to a browser download when native plugins are missing or fail', async () => {
    const { doc, pages } = await fixture();
    mocks.available = false;
    await expect(exportAsPdf(doc, pages)).rejects.toThrow('Native PDF sharing is unavailable');
    mocks.available = true; mocks.write.mockRejectedValue(new Error('Cache full'));
    await expect(exportAsPdf(doc, pages)).rejects.toThrow('Cache full');
    expect(mocks.share).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('treats native share cancellation as cancellation, without another dialog', async () => {
    const { doc, pages } = await fixture(); mocks.share.mockRejectedValue(new Error('Share canceled'));
    expect(await exportAsPdf(doc, pages)).toBe('cancelled');
  });
  it('saves through the native picker without needing a Share plugin or another app', async () => {
    mocks.saveAvailable = true; mocks.shareAvailable = false;
    const { doc, pages } = await fixture();
    expect(await exportAsPdf(doc, pages)).toBe('saved');
    expect(mocks.save).toHaveBeenCalledWith({ sourceUri: 'file:///data/user/0/app/cache/exports/test.pdf', fileName: 'Native scan.pdf' });
    expect(mocks.share).not.toHaveBeenCalled();
  });
  it('never opens Share after the user cancels the native file picker', async () => {
    mocks.saveAvailable = true; mocks.save.mockResolvedValue({ status: 'cancelled' });
    const { doc, pages } = await fixture();
    expect(await exportAsPdf(doc, pages)).toBe('cancelled'); expect(mocks.share).not.toHaveBeenCalled();
  });
  it('uses native Share only when the file picker is unavailable', async () => {
    mocks.saveAvailable = true; mocks.save.mockResolvedValue({ status: 'unavailable' });
    const { doc, pages } = await fixture();
    expect(await exportAsPdf(doc, pages)).toBe('native'); expect(mocks.share).toHaveBeenCalledOnce();
  });
  it('keeps a file-picker disk/profile failure visible instead of trying another destination', async () => {
    mocks.saveAvailable = true; mocks.save.mockRejectedValue(new Error('Saving is restricted by this profile.'));
    const { doc, pages } = await fixture();
    await expect(exportAsPdf(doc, pages)).rejects.toThrow('restricted by this profile');
    expect(mocks.share).not.toHaveBeenCalled();
  });
  it('reports when neither a system picker nor a native share destination is available', async () => {
    mocks.saveAvailable = true; mocks.shareAvailable = false; mocks.save.mockResolvedValue({ status: 'unavailable' });
    const { doc, pages } = await fixture();
    await expect(exportAsPdf(doc, pages)).rejects.toThrow('No native PDF save or share option');
  });
  it('does not accept an unrecognized native save response as success', async () => {
    mocks.saveAvailable = true; mocks.save.mockResolvedValue({ status: 'unknown' });
    await expect(savePdfNatively('file:///cache/exports/test.pdf', 'test.pdf')).rejects.toThrow('did not confirm');
  });
});

describe('bounded bridge messages for Fire tablet memory', () => {
  it('writes a large PDF in byte-exact chunks with no bridge payload larger than the bound', async () => {
    const original = Uint8Array.from({ length: NATIVE_PDF_CHUNK_BYTES * 2 + 137 }, (_, i) => i % 251);
    await writePdfToCache(new Blob([original]), 'large.pdf');
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.append).toHaveBeenCalledTimes(2);
    const chunks = [mocks.write.mock.calls[0][0], ...mocks.append.mock.calls.map(call => call[0])];
    for (const chunk of chunks) {
      expect(chunk.path).toBe(chunks[0].path); expect(chunk.directory).toBe('CACHE');
      expect(Buffer.from(chunk.data, 'base64').byteLength).toBeLessThanOrEqual(NATIVE_PDF_CHUNK_BYTES);
    }
    expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data, 'base64')))).toEqual(Buffer.from(original));
  });
  it('cleans up a partial private export if an append fails, without sharing it', async () => {
    mocks.append.mockRejectedValueOnce(new Error('Storage full'));
    await expect(writePdfToCache(new Blob([new Uint8Array(NATIVE_PDF_CHUNK_BYTES + 1)]), 'partial.pdf')).rejects.toThrow('Storage full');
    expect(mocks.remove).toHaveBeenCalledWith({ path: mocks.write.mock.calls[0][0].path, directory: 'CACHE' });
    expect(mocks.share).not.toHaveBeenCalled();
  });
  it('rejects empty PDF output before any native write', async () => {
    await expect(writePdfToCache(new Blob([]), 'empty.pdf')).rejects.toThrow('PDF is empty'); expect(mocks.write).not.toHaveBeenCalled();
  });
});
