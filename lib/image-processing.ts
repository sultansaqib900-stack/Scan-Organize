import { DraftPage, MAX_IMAGE_EDGE, newId, Point, Quad, ScanFilter } from './model';

export interface CapturedImage { image: Blob; width: number; height: number }
export const initialCorners = (): Quad => [{ x: 0.045, y: 0.035 }, { x: 0.955, y: 0.035 }, { x: 0.955, y: 0.965 }, { x: 0.045, y: 0.965 }];
const clamp = (n: number, min = 0, max = 255) => Math.max(min, Math.min(max, n));
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function isValidQuad(points: Quad): boolean {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0.001) return false;
    if (distance(a, b) < 0.055) return false;
    area += a.x * b.y - a.y * b.x;
  }
  return area / 2 >= 0.025;
}

/** A projective (not merely rectangular or bilinear) crop: map the output unit
 * rectangle back into the original four-sided document. */
export function homography(q: Quad): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  let g = 0, h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-10) {
    if (Math.abs(determinant) < 1e-10) throw new Error('Move the corners farther apart to crop this page.');
    g = (dx3 * dy2 - dx2 * dy3) / determinant;
    h = (dx1 * dy3 - dx3 * dy1) / determinant;
  }
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h];
}

export function project(matrix: number[], u: number, v: number): Point {
  const [a, b, c, d, e, f, g, h] = matrix;
  const divisor = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / divisor, y: (d * u + e * v + f) / divisor };
}

export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This image could not be opened. Please choose a JPEG, PNG, or WebP photo. HEIC support depends on your device.'));
    });
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export function canvasBlob(canvas: HTMLCanvasElement, quality = 0.91): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This page could not be processed. Try a smaller photo.')), 'image/jpeg', quality));
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width); canvas.height = Math.round(height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image processing is unavailable. Update Android System WebView, then reopen the app.');
  return { canvas, context };
}

export async function normalizePhoto(file: Blob): Promise<CapturedImage> {
  if (file.size > 30 * 1024 * 1024) throw new Error('This photo is too large. Choose an image smaller than 30 MB.');
  if (file.type === 'image/svg+xml' || (file.type && !file.type.startsWith('image/'))) throw new Error('Please choose a JPEG, PNG, or WebP photo.');
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  if (Math.min(width, height) < 60) throw new Error('This image is too small to scan. Please choose a larger photo.');
  const { canvas, context } = canvas2d(width, height);
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasBlob(canvas);
  canvas.width = canvas.height = 0;
  return { image: blob, width, height };
}

export async function captureFrame(video: HTMLVideoElement): Promise<CapturedImage> {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('The camera is still getting ready. Please try again in a moment.');
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  const { canvas, context } = canvas2d(width, height);
  context.drawImage(video, 0, 0, width, height);
  const image = await canvasBlob(canvas);
  canvas.width = canvas.height = 0;
  return { image, width, height };
}

export async function applyScanFilter(data: Uint8ClampedArray, width: number, height: number, filter: ScanFilter): Promise<void> {
  if (filter === 'color') {
    const source = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const p = source[i + c];
          const sharp = x > 0 && x < width - 1 && y > 0 && y < height - 1
            ? p + 0.16 * (4 * p - source[i - 4 + c] - source[i + 4 + c] - source[i - width * 4 + c] - source[i + width * 4 + c]) : p;
          data[i + c] = clamp((sharp - 128) * 1.18 + 135);
        }
        data[i + 3] = 255;
      }
      if (y % 96 === 0) await yieldToUI();
    }
    return;
  }
  // Local adaptive threshold handles uneven lighting better than a global cutoff.
  const gray = new Uint8Array(width * height);
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      gray[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
      sum += gray[i];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
    if (y % 128 === 0) await yieldToUI();
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 40));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
      const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
      const mean = (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
      const i = y * width + x, p = i * 4;
      const value = gray[i] < Math.min(185, mean - 12) || gray[i] < 65 ? 0 : 255;
      data[p] = data[p + 1] = data[p + 2] = value; data[p + 3] = 255;
    }
    if (y % 128 === 0) await yieldToUI();
  }
}

export async function processScan(capture: CapturedImage, corners: Quad, filter: ScanFilter): Promise<DraftPage> {
  if (!isValidQuad(corners)) throw new Error('Keep all four corners apart and around the document.');
  const image = await loadImage(capture.image);
  const sw = capture.width, sh = capture.height;
  const q = corners.map(p => ({ x: p.x * (sw - 1), y: p.y * (sh - 1) })) as Quad;
  let width = Math.max(distance(q[0], q[1]), distance(q[3], q[2]));
  let height = Math.max(distance(q[0], q[3]), distance(q[1], q[2]));
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  width = Math.max(32, Math.round(width * scale)); height = Math.max(32, Math.round(height * scale));
  const { canvas: source, context: sourceCtx } = canvas2d(sw, sh);
  sourceCtx.drawImage(image, 0, 0, sw, sh);
  const pixels = sourceCtx.getImageData(0, 0, sw, sh).data;
  source.width = source.height = 0;
  const { canvas, context } = canvas2d(width, height);
  const output = context.createImageData(width, height);
  const [a, b, c, d, e, f, g, h] = homography(q);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1), denominator = g * u + h * v + 1;
      const sx = clamp((a * u + b * v + c) / denominator, 0, sw - 1);
      const sy = clamp((d * u + e * v + f) / denominator, 0, sh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0, i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top = pixels[(y0 * sw + x0) * 4 + channel] * (1 - fx) + pixels[(y0 * sw + x1) * 4 + channel] * fx;
        const bottom = pixels[(y1 * sw + x0) * 4 + channel] * (1 - fx) + pixels[(y1 * sw + x1) * 4 + channel] * fx;
        output.data[i + channel] = top * (1 - fy) + bottom * fy;
      }
      output.data[i + 3] = 255;
    }
    if (y % 64 === 0) await yieldToUI();
  }
  await applyScanFilter(output.data, width, height, filter);
  context.putImageData(output, 0, 0);
  const blob = await canvasBlob(canvas);
  canvas.width = canvas.height = 0;
  return { id: newId(), image: blob, width, height };
}

export async function makeThumbnail(blob: Blob): Promise<Blob> {
  const image = await loadImage(blob);
  const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
  const { canvas, context } = canvas2d(image.naturalWidth * scale, image.naturalHeight * scale);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const thumbnail = await canvasBlob(canvas, 0.8);
  canvas.width = canvas.height = 0;
  return thumbnail;
}
