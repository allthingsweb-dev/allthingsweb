import { deflateSync } from "node:zlib";

/**
 * A stand-in for the media origin, serving photos the tests make, and
 * reading back the sizes of the images the Worker makes from them.
 */

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

/**
 * A `width` × `height` PNG: a gradient, so it doesn't compress to nothing
 * and a resized copy differs from it, or with `noise`, a pattern that
 * hardly compresses at all, about 3 bytes a pixel, for originals that are
 * large on the wire.
 */
export function png(
  width: number,
  height: number,
  { noise = false }: { readonly noise?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      rows.set(
        noise
          ? [(x * 7919 + y * 104_729) % 251, (x * y) % 241, (x ^ y) % 239]
          : [(x * 255) / width, (y * 255) / height, 128],
        row + 1 + x * 3,
      );
    }
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 1 })),
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

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  new TextDecoder().decode(bytes.subarray(start, start + length));

/** The width and height of a JPEG, WebP or AVIF, read from its headers. */
export function dimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // JPEG: the first start-of-frame marker holds them.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      const marker = bytes[at + 1] ?? 0;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        return {
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7),
        };
      }
      at += 2 + view.getUint16(at + 2);
    }
    return undefined;
  }
  // WebP: lossy, lossless or extended.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8 ") {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (kind === "VP8L") {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (kind === "VP8X") {
      const u24 = (at: number) =>
        (bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16);
      return { width: u24(24) + 1, height: u24(27) + 1 };
    }
    return undefined;
  }
  // AVIF: the image's spatial extents ("ispe") property.
  if (ascii(bytes, 4, 8) === "ftypavif") {
    for (let at = 0; at + 16 < bytes.length; at++) {
      if (ascii(bytes, at, 4) === "ispe") {
        return {
          width: view.getUint32(at + 8),
          height: view.getUint32(at + 12),
        };
      }
    }
  }
  return undefined;
}

/** `body` as a stream of 64 KB chunks, so no length is known up front. */
function inChunks(body: Uint8Array | string): ReadableStream<Uint8Array> {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(at, at + 65_536));
      at += 65_536;
    },
  });
}

/** What the stand-in serves at a key. */
export interface MediaFile {
  readonly body: Uint8Array | string;
  readonly type: string;
  /** Answers with this status instead, e.g. a redirect. */
  readonly status?: number;
  readonly location?: string;
  /** Sent in chunks, without a Content-Length. */
  readonly chunked?: true;
}

/**
 * The media origin's stand-in: `files` by key, 404 for anything else. It
 * keeps every path it was asked for, so tests can see what the Worker
 * fetched and what it didn't.
 */
export function serveMedia(files: Readonly<Record<string, MediaFile>>) {
  const requests: Array<string> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      const key = pathname
        .slice(1)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const file = files[key];
      if (file === undefined) return new Response("Not Found", { status: 404 });
      const body = file.chunked === true ? inChunks(file.body) : file.body;
      return new Response(body, {
        status: file.status ?? 200,
        headers: {
          "content-type": file.type,
          ...(file.location === undefined ? {} : { location: file.location }),
        },
      });
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    /** How often the Worker fetched `key`. */
    fetches: (key: string) =>
      requests.filter((path) => path === `/${key}`).length,
    stop: () => server.stop(true),
  };
}
