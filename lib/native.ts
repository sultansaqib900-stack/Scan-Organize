import { Capacitor, registerPlugin } from '@capacitor/core';

interface CameraAccessPlugin {
  request(): Promise<{ state: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
}
const CameraAccess = registerPlugin<CameraAccessPlugin>('CameraAccess');

export async function requestCameraAccess(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  if (!Capacitor.isPluginAvailable('CameraAccess')) {
    throw new Error('The device camera bridge is missing. Rebuild the Fire tablet app with the included CameraAccess plugin. You can still choose a photo.');
  }
  const result = await CameraAccess.request();
  if (result.state !== 'granted') throw new DOMException('Camera permission was not granted.', 'NotAllowedError');
}

export function cameraError(error: unknown): string {
  if (error instanceof Error) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)) {
      return 'Camera access is turned off. Allow Camera for Scan & Organize in your device or browser settings, then try again. You can also choose a photo below.';
    }
    if (['NotFoundError', 'DevicesNotFoundError'].includes(error.name)) return 'No camera was found on this device. You can choose a document photo instead.';
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) return 'The camera is busy or unavailable. Close any other app using it, then try again, or choose a photo.';
    return error.message;
  }
  return 'The camera could not start. Try again or choose a photo.';
}
