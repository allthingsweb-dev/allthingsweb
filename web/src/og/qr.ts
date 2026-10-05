import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import { encode } from "uqr";

/**
 * A QR code as a PNG, in the brand's Paper colors: Ink modules on Paper,
 * with the four-module quiet zone the standard asks for. The same URL
 * always makes the same bytes. route.ts loads this module only when a QR
 * code is asked for, so the encoder stays out of every other request's
 * start.
 */

/** Pixels per module: a version-3 code (29 modules) and its border is 444 px. */
const scale = 12;
const border = 4;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib (RFC 1950), as PNG's IDAT wants it, with the platform's own deflate. */
async function zlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const rgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** `url` as a QR code, a PNG of 8-bit indexed color. */
export async function qrPng(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const { data, size } = encode(url, { ecc: "M", border: 0 });
  const side = (size + 2 * border) * scale;
  // Two colors, by index: 0 is the ground, 1 a module.
  const rows = new Uint8Array((side + 1) * side);
  for (let y = 0; y < side; y++) {
    const row = y * (side + 1);
    const moduleY = Math.floor(y / scale) - border;
    for (let x = 0; x < side; x++) {
      const moduleX = Math.floor(x / scale) - border;
      rows[row + 1 + x] = data[moduleY]?.[moduleX] === true ? 1 : 0;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header.set([8, 3, 0, 0, 0], 8);
  const palette = new Uint8Array([
    ...rgb(roleColor(tokens, "paper", "ground").hex),
    ...rgb(roleColor(tokens, "paper", "text").hex),
  ]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", await zlib(rows)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
