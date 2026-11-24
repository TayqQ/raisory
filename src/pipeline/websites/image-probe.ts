/**
 * Image checks for company logos. The type comes from the file's magic bytes
 * only, never from a header, a file name or the page's markup, and the size
 * comes from the image's own header. Anything else, SVG and HTML included, is
 * refused. Pure functions with no dependencies.
 */

export const MIN_LOGO_SIDE = 32;
export const MIN_LOGO_ASPECT = 0.8;
export const MAX_LOGO_ASPECT = 1.25;

export type LogoMime =
  "image/png" | "image/jpeg" | "image/x-icon" | "image/webp" | "image/gif";

export type ProbeRejection =
  "empty" | "unknown-type" | "truncated" | "too-small" | "not-square";

export type ProbeResult =
  | { ok: true; mime: LogoMime; width: number; height: number }
  | { ok: false; reason: ProbeRejection };

interface Size {
  width: number;
  height: number;
}

type Header =
  | { kind: "image"; mime: LogoMime; size: Size }
  | { kind: "truncated" }
  | { kind: "unknown" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0) {
  if (bytes.length < at + prefix.length) return false;
  return prefix.every((value, i) => bytes[at + i] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  if (bytes.length < at + length) return "";
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, at: number): number {
  return u16be(bytes, at) * 0x10000 + u16be(bytes, at + 2);
}

function u32le(bytes: Uint8Array, at: number): number {
  return u16le(bytes, at) + u16le(bytes, at + 2) * 0x10000;
}

function pngSize(bytes: Uint8Array): Size | "truncated" | null {
  if (!startsWith(bytes, PNG_SIGNATURE)) return null;
  if (bytes.length < 24) return "truncated";
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** Start-of-frame markers that carry the image size. */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function jpegSize(bytes: Uint8Array): Size | "truncated" | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    while (bytes[at] === 0xff) at += 1;
    if (at >= bytes.length) return "truncated";
    const marker = bytes[at] ?? 0;
    at += 1;
    // Markers with no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // End of image, or the scan began with no frame header.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (at + 2 > bytes.length) return "truncated";
    const length = u16be(bytes, at);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (at + 7 > bytes.length) return "truncated";
      return { height: u16be(bytes, at + 3), width: u16be(bytes, at + 5) };
    }
    at += length;
  }
  return "truncated";
}

/** An ICO file: the largest entry, whose image data must be PNG or a bitmap. */
function icoSize(bytes: Uint8Array): Size | "truncated" | null {
  if (!startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return null;
  if (bytes.length < 6) return "truncated";
  const count = u16le(bytes, 4);
  if (count === 0) return null;
  if (bytes.length < 6 + count * 16) return "truncated";
  let best: (Size & { size: number; offset: number }) | null = null;
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = u32le(bytes, entry + 8);
    const offset = u32le(bytes, entry + 12);
    if (!best || width * height > best.width * best.height) {
      best = { width, height, size, offset };
    }
  }
  if (!best || best.size === 0) return null;
  if (best.offset + best.size > bytes.length) return "truncated";
  const image = bytes.subarray(best.offset, best.offset + best.size);
  const png = pngSize(image);
  if (png === "truncated") return "truncated";
  if (png) return png;
  // A bitmap entry starts with a 40-byte BITMAPINFOHEADER.
  if (image.length >= 40 && u32le(image, 0) === 40) {
    return { width: best.width, height: best.height };
  }
  return null;
}

function webpSize(bytes: Uint8Array): Size | "truncated" | null {
  if (ascii(bytes, 0, 4) !== "RIFF") return null;
  if (bytes.length < 16) return "truncated";
  if (ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return "truncated";
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25) return "truncated";
    if (bytes[20] !== 0x2f) return null;
    const bits = u32le(bytes, 21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    if (bytes.length < 30) return "truncated";
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  return null;
}

/** A GIF: the size of the first frame's image descriptor. */
function gifSize(bytes: Uint8Array): Size | "truncated" | null {
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  if (bytes.length < 13) return "truncated";
  const packed = bytes[10] ?? 0;
  let at = 13;
  if (packed & 0x80) at += 3 * 2 ** ((packed & 0x07) + 1);
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x2c) {
      if (at + 10 > bytes.length) return "truncated";
      return { width: u16le(bytes, at + 5), height: u16le(bytes, at + 7) };
    }
    if (block === 0x21) {
      // Extension: label, then sub-blocks until a zero-length one.
      at += 2;
      while (true) {
        if (at >= bytes.length) return "truncated";
        const length = bytes[at] ?? 0;
        at += 1 + length;
        if (length === 0) break;
      }
      continue;
    }
    // A trailer before any frame, or an unknown block.
    return null;
  }
  return "truncated";
}

const READERS: readonly [
  LogoMime,
  (bytes: Uint8Array) => Size | "truncated" | null,
][] = [
  ["image/png", pngSize],
  ["image/jpeg", jpegSize],
  ["image/x-icon", icoSize],
  ["image/webp", webpSize],
  ["image/gif", gifSize],
];

function readHeader(bytes: Uint8Array): Header {
  for (const [mime, read] of READERS) {
    const size = read(bytes);
    if (size === "truncated") return { kind: "truncated" };
    if (size) return { kind: "image", mime, size };
  }
  return { kind: "unknown" };
}

/** Checks a downloaded file and returns its type and size, or why it was refused. */
export function probeImage(bytes: Uint8Array): ProbeResult {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  const header = readHeader(bytes);
  if (header.kind === "unknown") return { ok: false, reason: "unknown-type" };
  if (header.kind === "truncated") return { ok: false, reason: "truncated" };
  const { width, height } = header.size;
  if (width < MIN_LOGO_SIDE || height < MIN_LOGO_SIDE) {
    return { ok: false, reason: "too-small" };
  }
  const aspect = width / height;
  if (aspect < MIN_LOGO_ASPECT || aspect > MAX_LOGO_ASPECT) {
    return { ok: false, reason: "not-square" };
  }
  return { ok: true, mime: header.mime, width, height };
}
