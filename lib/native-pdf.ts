import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeSaveStatus = 'saved' | 'cancelled' | 'unavailable';
interface PdfSavePlugin {
  save(options: { sourceUri: string; fileName: string }): Promise<{ status: NativeSaveStatus }>;
}
const PdfSave = registerPlugin<PdfSavePlugin>('PdfSave');

// Bound each bridge message instead of duplicating a whole multi-page PDF as
// base64 in a Fire tablet's smaller Java heap. The PDF itself stays a local Blob.
export const NATIVE_PDF_CHUNK_BYTES = 256 * 1024;

async function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not prepare the PDF. Your document is still saved. Please try again.'));
    reader.readAsDataURL(blob);
  });
}

export async function writePdfToCache(blob: Blob, fileName: string): Promise<string> {
  if (!blob.size) throw new Error('The PDF is empty. Please try exporting again.');
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = `exports/${Date.now()}-${fileName}`;
  try {
    const { uri } = await Filesystem.writeFile({
      path,
      data: await base64(blob.slice(0, NATIVE_PDF_CHUNK_BYTES)),
      directory: Directory.Cache,
      recursive: true,
    });
    for (let offset = NATIVE_PDF_CHUNK_BYTES; offset < blob.size; offset += NATIVE_PDF_CHUNK_BYTES) {
      await Filesystem.appendFile({ path, directory: Directory.Cache, data: await base64(blob.slice(offset, offset + NATIVE_PDF_CHUNK_BYTES)) });
    }
    return uri;
  } catch (error) {
    // A partially written private export must never be handed to another app.
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
    throw error;
  }
}

export async function savePdfNatively(sourceUri: string, fileName: string): Promise<NativeSaveStatus> {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('PdfSave')) return 'unavailable';
  const result = await PdfSave.save({ sourceUri, fileName });
  if (!['saved', 'cancelled', 'unavailable'].includes(result.status)) {
    throw new Error('The device did not confirm the PDF save. Your original document is still on this device.');
  }
  return result.status;
}
