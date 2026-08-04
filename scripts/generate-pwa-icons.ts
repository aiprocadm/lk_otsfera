/**
 * Generates PWA icons (192, 512, 180 = apple-touch-icon) as flat PNGs
 * without any third-party dependency.
 *
 * Pure Node:
 *  - PNG byte layout written by hand (signature + IHDR + IDAT + IEND)
 *  - zlib.deflateSync for IDAT compression
 *  - CRC32 table built locally
 *
 * Design: brand-orange (#F97316) background + centered white disc
 * (radius = 30% of canvas) so the icon survives both "any" and
 * "maskable" purposes declared in public/manifest.webmanifest.
 *
 * Run once with `npx tsx scripts/generate-pwa-icons.ts`. Output is
 * committed under public/.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: number[] = (() => {
  const t = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  // `& 0xff` даёт индекс 0..255, а CRC_TABLE построена ровно на 256 элементов.
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function ihdr(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(width, 0);
  buf.writeUInt32BE(height, 4);
  buf[8] = 8; // bit depth
  buf[9] = 2; // color type: RGB
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace
  return buf;
}

type RGB = [number, number, number];

const ORANGE: RGB = [0xf9, 0x73, 0x16];
const WHITE: RGB = [0xff, 0xff, 0xff];

function pixel(x: number, y: number, size: number): RGB {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.3;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= r * r ? WHITE : ORANGE;
}

function makePng(size: number): Buffer {
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr(size, size)),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs: Array<{ name: string; size: number }> = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const publicDir = resolve(process.cwd(), 'public');
for (const { name, size } of outputs) {
  const buf = makePng(size);
  const path = resolve(publicDir, name);
  writeFileSync(path, buf);
  console.log(`wrote ${name} (${size}×${size}, ${buf.length} bytes)`);
}
