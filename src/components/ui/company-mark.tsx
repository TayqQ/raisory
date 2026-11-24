import { Monogram, type MonogramSize } from "./monogram";

/** Tile size classes and padding. The sizes match the monogram's. */
const TILE: Record<MonogramSize, string> = {
  24: "h-6 w-6 p-[3px]",
  28: "h-7 w-7 p-[3px]",
  40: "h-10 w-10 p-1",
  56: "h-14 w-14 p-1.5",
};

/**
 * The company's logo, or its monogram when there is none. A logo sits on a
 * light tile in both themes (so a dark logo stays visible in dark mode) with a
 * hairline `line` border, which follows the theme. The image is
 * `object-fit: contain` with explicit width and height, so nothing shifts as
 * it loads. `alt` is empty because the company's name is always beside it.
 * `logoUrl` is a `/logos/...` address from `getLogoUrls` (D72), never a
 * company's own image.
 */
export function CompanyMark({
  name,
  logoUrl,
  size = 28,
}: {
  name: string;
  logoUrl?: string | null;
  size?: MonogramSize;
}) {
  if (!logoUrl) return <Monogram name={name} size={size} />;
  return (
    <span
      data-testid="company-logo"
      className={`box-border inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-line bg-white ${TILE[size]}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a small checked copy served from our own route, so there is nothing to optimise */}
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
      />
    </span>
  );
}
