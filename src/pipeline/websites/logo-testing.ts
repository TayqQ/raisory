/**
 * Test helpers for company logos: small images built byte by byte, so no
 * third-party logo is ever stored in the repo. Only the PNG is a complete,
 * decodable image; the other formats carry valid headers and minimal data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function loadLogoFixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(path.join(repoRoot, "fixtures/logos", name)),
  );
}

function concat(...parts: (Uint8Array | readonly number[])[]): Uint8Array {
  const arrays = parts.map((part) =>
    part instanceof Uint8Array ? part : Uint8Array.from(part),
  );
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
  let at = 0;
  for (const array of arrays) {
    out.set(array, at);
    at += array.length;
  }
  return out;
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return [...u16le(value & 0xffff), ...u16le(value >>> 16)];
}

function u32be(value: number): number[] {
  return [...u16be(value >>> 16), ...u16be(value & 0xffff)];
}

function text(value: string): number[] {
  return [...value].map((c) => c.charCodeAt(0));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat(text(type), data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

/** A complete single-colour RGB PNG. */
export function pngBytes(width: number, height: number): Uint8Array {
  const header = concat(u32be(width), u32be(height), [8, 2, 0, 0, 0]);
  const row = concat([0], new Uint8Array(width * 3).fill(0x2a));
  const raw = concat(...Array.from({ length: height }, () => row));
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  );
}

/** A JPEG header: SOI, a JFIF APP0 segment, a baseline frame header and EOI. */
export function jpegBytes(width: number, height: number): Uint8Array {
  const app0 = [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0];
  return concat(
    [0xff, 0xd8],
    [0xff, 0xe0, ...u16be(app0.length + 2), ...app0],
    [0xff, 0xc0, ...u16be(sof0.length + 2), ...sof0],
    [0xff, 0xd9],
  );
}

export interface IcoEntry {
  width: number;
  height: number;
  /** PNG image data (the default) or a bitmap header. */
  format?: "png" | "bmp";
}

/** A 40-byte BITMAPINFOHEADER, as an ICO bitmap entry starts. */
function bitmapHeader(width: number, height: number): Uint8Array {
  const header = concat(
    u32le(40),
    u32le(width || 256),
    u32le((height || 256) * 2),
    u16le(1),
    u16le(32),
  );
  return concat(header, new Uint8Array(40 - header.length));
}

/** An ICO file with one image per entry. */
export function icoBytes(entries: readonly IcoEntry[]): Uint8Array {
  const images = entries.map(({ width, height, format = "png" }) =>
    format === "png" ? pngBytes(width, height) : bitmapHeader(width, height),
  );
  const directory: number[] = [];
  let offset = 6 + entries.length * 16;
  entries.forEach(({ width, height }, i) => {
    const size = images[i]?.length ?? 0;
    directory.push(width & 0xff, height & 0xff, 0, 0, ...u16le(1));
    directory.push(...u16le(32), ...u32le(size), ...u32le(offset));
    offset += size;
  });
  return concat([0, 0, 1, 0, ...u16le(entries.length)], directory, ...images);
}

function riff(chunk: string, data: readonly number[]): Uint8Array {
  const body = [
    ...text("WEBP"),
    ...text(chunk),
    ...u32le(data.length),
    ...data,
  ];
  return concat(text("RIFF"), u32le(body.length), body);
}

/** A lossy WebP header. */
export function webpVp8Bytes(width: number, height: number): Uint8Array {
  return riff("VP8 ", [
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...u16le(width),
    ...u16le(height),
  ]);
}

/** A lossless WebP header. */
export function webpVp8lBytes(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riff("VP8L", [0x2f, ...u32le(bits >>> 0), 0]);
}

/** An extended WebP header. */
export function webpVp8xBytes(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8X", [
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >>> 8) & 0xff,
    (w >>> 16) & 0xff,
    h & 0xff,
    (h >>> 8) & 0xff,
    (h >>> 16) & 0xff,
  ]);
}

/**
 * A GIF89a with a global colour table, a graphic control extension and one
 * frame. The screen size can differ from the frame size.
 */
export function gifBytes(
  width: number,
  height: number,
  screen: { width: number; height: number } = { width, height },
): Uint8Array {
  return concat(
    text("GIF89a"),
    [...u16le(screen.width), ...u16le(screen.height), 0x80, 0, 0],
    [0, 0, 0, 0xff, 0xff, 0xff],
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c, 0, 0, 0, 0, ...u16le(width), ...u16le(height), 0],
    [2, 2, 0x44, 0x01, 0],
    [0x3b],
  );
}

export function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
