export function decodeMessage(bytes) {
  if (!bytes?.length) return {};
  const fields = {};
  let offset = 0;

  while (offset < bytes.length) {
    let tag, tagLen;
    try { [tag, tagLen] = readVarint(bytes, offset); } catch { break; }
    if (!tagLen) break;
    offset += tagLen;

    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    let value;

    try {
      switch (wireType) {
        case 0: {
          const [v, n] = readVarint(bytes, offset); offset += n;
          value = { type: v === 0n || v === 1n ? 'bool/int' : 'int', value: Number(v) };
          break;
        }
        case 1: {
          if (offset + 8 > bytes.length) return fields;
          const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
          value = { type: 'int64/double', int64: Number(dv.getBigInt64(0, true)), double: dv.getFloat64(0, true) };
          offset += 8;
          break;
        }
        case 2: {
          const [len, lenN] = readVarint(bytes, offset); offset += lenN;
          const slice = bytes.slice(offset, offset + Number(len)); offset += Number(len);
          value = interpretLenDelim(slice);
          break;
        }
        case 5: {
          if (offset + 4 > bytes.length) return fields;
          const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
          value = { type: 'int32/float', int32: dv.getInt32(0, true), float: dv.getFloat32(0, true) };
          offset += 4;
          break;
        }
        default: return fields;
      }
    } catch { break; }

    const key = String(fieldNumber);
    if (fields[key] !== undefined) {
      if (!Array.isArray(fields[key])) fields[key] = [fields[key]];
      fields[key].push(value);
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

function interpretLenDelim(data) {
  if (!data.length) return { type: 'string', value: '' };
  try {
    const str = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(str)) return { type: 'string', value: str };
  } catch {}
  try {
    const nested = decodeMessage(data);
    if (Object.keys(nested).length > 0) return { type: 'message', value: nested };
  } catch {}
  return { type: 'bytes', value: Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ') };
}

function readVarint(bytes, offset) {
  let result = 0n, shift = 0n, pos = offset;
  while (pos < bytes.length) {
    const byte = bytes[pos++];
    result |= BigInt(byte & 0x7F) << shift;
    shift += 7n;
    if (!(byte & 0x80)) break;
    if (shift > 63n) throw new Error('Varint overflow');
  }
  return [result, pos - offset];
}
