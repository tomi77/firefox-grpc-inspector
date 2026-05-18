import { describe, it, expect } from 'vitest';
import { decodeFrames, bodyToBytes } from '../src/lib/grpc-web-decoder.js';

describe('bodyToBytes', () => {
  it('converts base64 string to Uint8Array', () => {
    // [0x08, 0x01] = "CAE=" in base64
    expect(bodyToBytes('CAE=', 'base64')).toEqual(new Uint8Array([0x08, 0x01]));
  });

  it('passes Uint8Array through unchanged', () => {
    const input = new Uint8Array([1, 2, 3]);
    expect(bodyToBytes(input, null)).toEqual(input);
  });

  it('handles empty string', () => {
    expect(bodyToBytes('', 'base64')).toEqual(new Uint8Array(0));
  });
});

describe('decodeFrames', () => {
  it('decodes single data frame', () => {
    // flags=0x00, length=3 (big-endian uint32), body=[0x08,0x01,0x12]
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x03, 0x08, 0x01, 0x12]);
    const frames = decodeFrames(data);
    expect(frames).toHaveLength(1);
    expect(frames[0].isTrailer).toBe(false);
    expect(frames[0].data).toEqual(new Uint8Array([0x08, 0x01, 0x12]));
  });

  it('decodes trailer frame (flag 0x80)', () => {
    const data = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00]);
    const frames = decodeFrames(data);
    expect(frames[0].isTrailer).toBe(true);
    expect(frames[0].data).toEqual(new Uint8Array(0));
  });

  it('decodes multiple consecutive frames', () => {
    const data = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, 0x02, 0xAA, 0xBB,
      0x80, 0x00, 0x00, 0x00, 0x00,
    ]);
    const frames = decodeFrames(data);
    expect(frames).toHaveLength(2);
    expect(frames[0].data).toEqual(new Uint8Array([0xAA, 0xBB]));
    expect(frames[1].isTrailer).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(decodeFrames(new Uint8Array(0))).toEqual([]);
  });

  it('ignores incomplete header', () => {
    expect(decodeFrames(new Uint8Array([0x00, 0x00, 0x00]))).toEqual([]);
  });
});
