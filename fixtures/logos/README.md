# Company logo fixtures

Small synthetic images for the logo tests (D72). They were built byte by byte with the helpers in `src/pipeline/websites/logo-testing.ts`, so no company's logo is stored in the repo.

- `square-64.png`: a complete 64 × 64 single-colour PNG.
- `square-48.jpg`, `square-40.gif`, `square-64-lossy.webp`, `square-64-lossless.webp` and `square-64-extended.webp`: valid headers with minimal image data, enough for the magic-byte and size checks in `image-probe.ts`.
- `multi-16-32-48.ico`: an icon with 16 × 16 and 48 × 48 PNG entries and a 32 × 32 bitmap entry.
- `icon.svg`: an SVG file, which the probe must refuse.

Variants (too small, too wide, truncated, wrong magic number) are built in the tests themselves.
