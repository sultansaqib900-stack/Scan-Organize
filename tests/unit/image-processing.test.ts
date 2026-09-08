import { describe, expect, it } from 'vitest';
import { applyScanFilter, homography, initialCorners, isValidQuad, project } from '@/lib/image-processing';
import { Quad } from '@/lib/model';

const square: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const trapezoid: Quad = [{ x: .2, y: .1 }, { x: .8, y: .2 }, { x: .95, y: .9 }, { x: .05, y: .85 }];

describe('perspective crop geometry', () => {
  it('maps the unit rectangle to itself', () => {
    const matrix = homography(square);
    expect(project(matrix, .23, .78)).toEqual({ x: .23, y: .78 });
  });
  it('maps all four output corners exactly to the selected source corners', () => {
    const matrix = homography(trapezoid);
    for (let i = 0; i < 4; i++) {
      const mapped = project(matrix, square[i].x, square[i].y);
      expect(mapped.x).toBeCloseTo(trapezoid[i].x, 10); expect(mapped.y).toBeCloseTo(trapezoid[i].y, 10);
    }
  });
  it('preserves straight lines under projective correction', () => {
    const matrix = homography(trapezoid);
    const a = project(matrix, .1, .1), b = project(matrix, .5, .5), c = project(matrix, .9, .9);
    expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeCloseTo(0, 10);
  });
  it('accepts convex, in-bounds crops', () => {
    expect(isValidQuad(square)).toBe(true); expect(isValidQuad(trapezoid)).toBe(true); expect(isValidQuad(initialCorners())).toBe(true);
  });
  it('rejects crossed, concave, tiny, and out-of-bounds crops', () => {
    expect(isValidQuad([square[0], square[2], square[1], square[3]])).toBe(false);
    expect(isValidQuad([square[0], square[1], { x: .1, y: .1 }, square[3]])).toBe(false);
    expect(isValidQuad(square.map(p => ({ x: p.x * .1, y: p.y * .1 })) as Quad)).toBe(false);
    expect(isValidQuad([{ x: -.1, y: 0 }, square[1], square[2], square[3]])).toBe(false);
    expect(isValidQuad([{ x: NaN, y: 0 }, square[1], square[2], square[3]])).toBe(false);
  });
});

describe('canvas pixel filters', () => {
  it('increases contrast, brightens the paper and leaves pixels opaque', async () => {
    const pixels = new Uint8ClampedArray([30, 30, 30, 0, 220, 220, 220, 0]);
    await applyScanFilter(pixels, 2, 1, 'color');
    expect(pixels[0]).toBeLessThan(30); expect(pixels[4]).toBeGreaterThan(220); expect(pixels[3]).toBe(255); expect(pixels[7]).toBe(255);
  });
  it('produces only black or white pixels and retains dark text', async () => {
    const pixels = new Uint8ClampedArray(20 * 20 * 4).fill(230);
    const center = (10 * 20 + 10) * 4;
    pixels[center] = pixels[center + 1] = pixels[center + 2] = 15;
    await applyScanFilter(pixels, 20, 20, 'bw');
    expect(pixels[center]).toBe(0); expect(pixels[0]).toBe(255);
    for (const value of pixels) expect([0, 255]).toContain(value);
  });
});
