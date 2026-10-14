import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

import { readTemplate } from './template/template-config.ts';

// Deterministic generic template mark, not an imported product icon or a native build dependency.
function icon(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const segments = [
    [11, 16, 53, 16],
    [11, 48, 53, 48],
    [15, 24, 32, 41],
    [32, 41, 49, 24],
    [32, 41, 32, 16],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = ((x + 0.5) * 64) / size;
      const py = ((y + 0.5) * 64) / size;
      const stroke = segments.some(([ax, ay, bx, by]) => {
        const t = Math.max(
          0,
          Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
        );

        return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)) <= 2;
      });
      const node = [
        [15, 24],
        [32, 41],
        [49, 24],
      ].some(([cx, cy]) => Math.hypot(px - cx, py - cy) <= 3);
      const rgba = node ? [250, 250, 250, 255] : stroke ? [96, 165, 250, 255] : [24, 24, 27, 255];

      raw.set(rgba, y * (size * 4 + 1) + 1 + x * 4);
    }
  }

  function chunk(type: string, data: Buffer): Buffer {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;

    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);

    header.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);

    return Buffer.concat([header, bytes, checksum]);
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const template = await readTemplate(process.cwd());
const output = 'dist/pwa-assets';

await mkdir(`${output}/icons`, { recursive: true });
await Promise.all(
  [192, 512].map(async (size) => {
    await writeFile(`${output}/icons/icon-${size}.png`, icon(size));
  }),
);
await writeFile(
  `${output}/manifest.webmanifest`,
  `${JSON.stringify(
    {
      name: template.project.name,
      short_name: template.project.name,
      id: '/app/',
      start_url: './',
      scope: './',
      display: 'standalone',
      theme_color: '#18181b',
      background_color: '#ffffff',
      icons: [192, 512].map((size) => ({
        src: `icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'any',
      })),
    },
    null,
    2,
  )}\n`,
);
