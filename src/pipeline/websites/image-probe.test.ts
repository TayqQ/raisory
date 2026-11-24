import { describe, expect, it } from "vitest";
import { probeImage } from "./image-probe";
import {
  gifBytes,
  icoBytes,
  jpegBytes,
  loadLogoFixture,
  pngBytes,
  textBytes,
  webpVp8Bytes,
  webpVp8lBytes,
  webpVp8xBytes,
} from "./logo-testing";

describe("probeImage", () => {
  it.each([
    ["square-64.png", "image/png", 64, 64],
    ["square-48.jpg", "image/jpeg", 48, 48],
    ["multi-16-32-48.ico", "image/x-icon", 48, 48],
    ["square-64-lossy.webp", "image/webp", 64, 64],
    ["square-64-lossless.webp", "image/webp", 64, 64],
    ["square-64-extended.webp", "image/webp", 64, 64],
    ["square-40.gif", "image/gif", 40, 40],
  ])("accepts %s from its magic bytes", (name, mime, width, height) => {
    expect(probeImage(loadLogoFixture(name))).toEqual({
      ok: true,
      mime,
      width,
      height,
    });
  });

  it("reads the largest ICO entry, including a bitmap one", () => {
    const ico = icoBytes([
      { width: 16, height: 16 },
      { width: 0, height: 0, format: "bmp" },
    ]);
    expect(probeImage(ico)).toEqual({
      ok: true,
      mime: "image/x-icon",
      width: 256,
      height: 256,
    });
  });

  it("uses the first GIF frame, not the screen size", () => {
    expect(probeImage(gifBytes(16, 16, { width: 64, height: 64 }))).toEqual({
      ok: false,
      reason: "too-small",
    });
    expect(
      probeImage(gifBytes(64, 64, { width: 16, height: 16 })),
    ).toMatchObject({ ok: true, width: 64, height: 64 });
  });

  it("refuses an icon under 32 × 32", () => {
    expect(probeImage(pngBytes(31, 31))).toEqual({
      ok: false,
      reason: "too-small",
    });
    expect(probeImage(icoBytes([{ width: 16, height: 16 }]))).toEqual({
      ok: false,
      reason: "too-small",
    });
    expect(probeImage(pngBytes(32, 32))).toMatchObject({ ok: true });
  });

  it("refuses a wide or tall logo and keeps the 0.8-1.25 range", () => {
    expect(probeImage(pngBytes(200, 50))).toEqual({
      ok: false,
      reason: "not-square",
    });
    expect(probeImage(jpegBytes(40, 60))).toEqual({
      ok: false,
      reason: "not-square",
    });
    expect(probeImage(webpVp8Bytes(50, 40))).toMatchObject({ ok: true });
    expect(probeImage(webpVp8lBytes(40, 50))).toMatchObject({ ok: true });
    expect(probeImage(webpVp8xBytes(51, 40))).toEqual({
      ok: false,
      reason: "not-square",
    });
  });

  it("refuses SVG", () => {
    expect(probeImage(loadLogoFixture("icon.svg"))).toEqual({
      ok: false,
      reason: "unknown-type",
    });
    expect(
      probeImage(textBytes('<?xml version="1.0"?><svg width="64"></svg>')),
    ).toEqual({ ok: false, reason: "unknown-type" });
  });

  it("refuses HTML served as an image", () => {
    expect(
      probeImage(
        textBytes("<!doctype html><html><body>Not found</body></html>"),
      ),
    ).toEqual({ ok: false, reason: "unknown-type" });
  });

  it("refuses a wrong magic number and an empty file", () => {
    const png = pngBytes(64, 64);
    png[1] = 0x51;
    expect(probeImage(png)).toEqual({ ok: false, reason: "unknown-type" });
    const cursor = icoBytes([{ width: 64, height: 64 }]);
    cursor[2] = 2;
    expect(probeImage(cursor)).toEqual({ ok: false, reason: "unknown-type" });
    expect(probeImage(new Uint8Array())).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it.each([
    ["PNG", pngBytes(64, 64), 20],
    ["JPEG", jpegBytes(64, 64), 22],
    ["ICO", icoBytes([{ width: 64, height: 64 }]), 30],
    ["WebP", webpVp8Bytes(64, 64), 27],
    ["GIF", gifBytes(64, 64), 25],
  ])("refuses a truncated %s", (_, bytes, keep) => {
    expect(probeImage(bytes.subarray(0, keep))).toEqual({
      ok: false,
      reason: "truncated",
    });
  });
});
