export function bodyToBytes(body, encoding) {
  if (body instanceof Uint8Array) return body;
  if (typeof body !== 'string' || !body) return new Uint8Array(0);
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeFrames(data) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= data.length) {
    const flags = data[offset];
    const length = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0, false);
    offset += 5;
    if (offset + length > data.length) break;
    frames.push({ isTrailer: (flags & 0x80) !== 0, data: data.slice(offset, offset + length) });
    offset += length;
  }
  return frames;
}
