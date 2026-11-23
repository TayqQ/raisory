import { CountryFlag } from "./country-flag";

/**
 * A small country flag plus the town. The flag's alt text is the country, so
 * a screen reader hears "United Kingdom, London". "Place not known" in muted
 * text when neither is known.
 */
export function PlaceBadge({
  countryCode,
  city,
  size,
}: {
  countryCode: string | null;
  city: string | null;
  size?: "sm" | "lg";
}) {
  const code = countryCode?.trim() || null;
  const town = city?.trim() || null;
  if (!code && !town) {
    return <span className="text-muted">Place not known</span>;
  }
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {code ? <CountryFlag countryCode={code} size={size} /> : null}
      {code && town ? <span className="sr-only">,</span> : null}
      {town ? <span className="truncate text-ink">{town}</span> : null}
    </span>
  );
}
