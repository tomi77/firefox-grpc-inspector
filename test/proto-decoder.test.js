import { describe, it, expect } from 'vitest';
import { decodeMessage } from '../src/lib/proto-decoder.js';

describe('decodeMessage', () => {
  it('decodes varint field', () => {
    // field 1, wire 0 (varint): tag=0x08, value=42=0x2A
    const result = decodeMessage(new Uint8Array([0x08, 0x2A]));
    expect(result['1'].type).toMatch(/int/);
    expect(result['1'].value).toBe(42);
  });

  it('decodes string field', () => {
    // field 2, wire 2: tag=0x12, len=5, "hello"
    const result = decodeMessage(new Uint8Array([0x12, 0x05, 0x68, 0x65, 0x6C, 0x6C, 0x6F]));
    expect(result['2'].type).toBe('string');
    expect(result['2'].value).toBe('hello');
  });

  it('decodes multiple fields', () => {
    const bytes = new Uint8Array([0x08, 0x2A, 0x12, 0x05, 0x68, 0x65, 0x6C, 0x6C, 0x6F]);
    const result = decodeMessage(bytes);
    expect(result['1'].value).toBe(42);
    expect(result['2'].value).toBe('hello');
  });

  it('decodes nested message', () => {
    // field 3, wire 2, body=[0x08,0x07] = {1: 7}
    const result = decodeMessage(new Uint8Array([0x1A, 0x02, 0x08, 0x07]));
    expect(result['3'].type).toBe('message');
    expect(result['3'].value['1'].value).toBe(7);
  });

  it('returns empty object for empty input', () => {
    expect(decodeMessage(new Uint8Array(0))).toEqual({});
  });

  it('marks 0/1 varint as bool/int', () => {
    const result = decodeMessage(new Uint8Array([0x08, 0x01]));
    expect(result['1'].type).toMatch(/bool/);
  });

  it('decodes unreadable bytes as hex', () => {
    // field 1, wire 2, body=[0xFF, 0xFE] — not valid UTF-8, not valid protobuf
    const result = decodeMessage(new Uint8Array([0x0A, 0x02, 0xFF, 0xFE]));
    expect(result['1'].type).toBe('bytes');
  });
});
