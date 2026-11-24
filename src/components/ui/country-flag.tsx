/**
 * A small country flag, from the static SVGs in `public/flags` (see
 * `scripts/build-flags.ts`). Server-safe: no hooks and no client JavaScript.
 * The name, from `Intl.DisplayNames`, is the alt text and the hover title.
 * A null code renders nothing. A code with no flag file shows as text.
 */

/** Lower-case codes with a file in `public/flags`. A test keeps this in step. */
export const FLAG_CODES: ReadonlySet<string> = new Set(
  "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu ic id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz ta tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws xa xc xk xo ye yt za zm zw".split(
    " ",
  ),
);

const COUNTRY_NAMES = new Intl.DisplayNames(["en-GB"], { type: "region" });

/** "United Kingdom" for `GB`. Falls back to the code when the name is unknown. */
export function countryNameFor(code: string): string {
  try {
    return COUNTRY_NAMES.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const SIZES = {
  /** Rows, cards and chips. */
  sm: { width: 20, height: 15, box: "h-[15px] w-[20px]" },
  /** The company header. */
  lg: { width: 24, height: 18, box: "h-[18px] w-[24px]" },
} as const;

export function CountryFlag({
  countryCode,
  size = "sm",
  decorative = false,
  className = "",
}: {
  countryCode: string | null | undefined;
  size?: keyof typeof SIZES;
  /** Use beside the country's name in text, so it is not read out twice. */
  decorative?: boolean;
  className?: string;
}) {
  const code = countryCode?.trim();
  if (!code) return null;
  const lower = code.toLowerCase();
  const upper = code.toUpperCase();
  if (!FLAG_CODES.has(lower)) {
    if (decorative) return null;
    return (
      <span
        className={`shrink-0 rounded-[var(--radius-sm)] bg-surface-sunk px-1 py-0.5 text-xs font-semibold tracking-wide text-ink ${className}`}
      >
        {upper}
      </span>
    );
  }
  const name = countryNameFor(upper);
  const { width, height, box } = SIZES[size];
  return (
    // A plain img: the files are tiny static SVGs that next/image would not shrink.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${lower}.svg`}
      width={width}
      height={height}
      alt={decorative ? "" : name}
      title={decorative ? undefined : name}
      loading="lazy"
      decoding="async"
      className={`inline-block shrink-0 ${box} rounded-[2px] object-cover outline outline-1 -outline-offset-1 outline-line ${className}`}
    />
  );
}
