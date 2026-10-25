// Minimal CBOR encoding for a synthetic ES256 authenticator, not production protocol handling.
export function cbor(value: number | string | Buffer | Map<unknown, unknown>): Buffer {
  const header = (major: number, length: number) =>
    length < 24
      ? Buffer.from([(major << 5) | length])
      : length < 256
        ? Buffer.from([(major << 5) | 24, length])
        : Buffer.from([(major << 5) | 25, length >> 8, length & 255]);

  if (typeof value === 'number') {
    return header(value >= 0 ? 0 : 1, value >= 0 ? value : -1 - value);
  }

  if (typeof value === 'string') {
    return Buffer.concat([header(3, Buffer.byteLength(value)), Buffer.from(value)]);
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.concat([header(2, value.length), value]);
  }

  return Buffer.concat([
    header(5, value.size),
    ...[...value].flatMap(([key, item]) => [cbor(key as never), cbor(item as never)]),
  ]);
}
