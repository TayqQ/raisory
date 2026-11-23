import { chromium } from "@playwright/test";

// Usage: pnpm screenshots [base url] [company slug] [news-only company slug].
// Needs `pnpm exec playwright install chromium`, or CHROMIUM_PATH pointing at
// a browser you already have. The first company should be a UK company
// confirmed by Companies House; the second one known from news only.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const company = process.argv[3] ?? "northwind-robotics";
const newsOnlyCompany = process.argv[4];

type Theme = "light" | "dark";

interface Shot {
  path: string;
  file: string;
  width: number;
  height: number;
  theme?: Theme;
  /** Capture the whole page, not only the first screen. */
  fullPage?: boolean;
  /** Device pixel ratio, for sharp phone shots. */
  scale?: number;
}

/**
 * The company page (task 077) at 375 x 812 and 1280 x 800, light and dark.
 * The 375 first-screen shot shows whether the header, key facts and latest
 * round fit without scrolling; the full-page shot shows the phone order.
 */
function companyShots(slug: string, name: string): Shot[] {
  const shots: Shot[] = [];
  for (const theme of ["light", "dark"] as const) {
    const path = `/companies/${slug}`;
    shots.push(
      {
        path,
        file: `${name}-375-${theme}.png`,
        width: 375,
        height: 812,
        theme,
      },
      {
        path,
        file: `${name}-375-${theme}-full.png`,
        width: 375,
        height: 812,
        theme,
        fullPage: true,
      },
      {
        path,
        file: `${name}-1280-${theme}.png`,
        width: 1280,
        height: 800,
        theme,
      },
    );
  }
  return shots;
}

/**
 * The home page (task 079) in List and Cards, light and dark, at 375 and
 * 1280 px. `?view=` picks the view, so no cookie is needed. Phones always show
 * the stacked list; the 375 Cards shot checks that. The 375 shots are full
 * page, to show the summary, the quick views and the row stacks.
 */
function homeShots(): Shot[] {
  const shots: Shot[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const view of ["list", "cards"] as const) {
      const path = view === "list" ? "/" : `/?view=${view}`;
      shots.push(
        {
          path,
          file: `home-${view}-375-${theme}.png`,
          width: 375,
          height: 812,
          theme,
          fullPage: true,
        },
        {
          path,
          file: `home-${view}-1280-${theme}.png`,
          width: 1280,
          height: 800,
          theme,
        },
      );
    }
  }
  return shots;
}

/**
 * The Split view (task 080) at 1280 px, light and dark: compact rows on the
 * left and the first row's company preview on the right.
 */
function splitShots(): Shot[] {
  return (["light", "dark"] as const).map((theme) => ({
    path: "/?view=split",
    file: `home-split-1280-${theme}.png`,
    width: 1280,
    height: 800,
    theme,
  }));
}

/**
 * The other pages (task 081) at 375 px, light and dark, full page, to check
 * that nothing scrolls sideways and the stacked tables read well.
 */
function otherPageShots(): Shot[] {
  const pages = [
    "trends",
    "investors",
    "acquisitions",
    "themes",
    "about",
    "status",
  ];
  const shots: Shot[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const name of pages) {
      shots.push({
        path: `/${name}`,
        file: `${name}-375-${theme}.png`,
        width: 375,
        height: 812,
        theme,
        fullPage: true,
      });
    }
  }
  return shots;
}

/**
 * The app shell (task 083) at 1440, 1100, 800 and 375 px, light and dark: the
 * full sidebar, the icon rail (twice, at 1100 and 800) and the phone top bar
 * with the bottom tab bar. An investor page shows a non-home active item.
 */
function shellShots(): Shot[] {
  const sizes = [
    { width: 1440, height: 900 },
    { width: 1100, height: 800 },
    { width: 800, height: 900 },
    { width: 375, height: 812 },
  ];
  const shots: Shot[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const { width, height } of sizes) {
      shots.push(
        {
          path: "/",
          file: `shell-${width}-${theme}.png`,
          width,
          height,
          theme,
        },
        {
          path: "/investors",
          file: `shell-investors-${width}-${theme}.png`,
          width,
          height,
          theme,
        },
      );
    }
  }
  return shots;
}

/**
 * The images the README shows. The hero filters to seed and Series A, so a
 * single very large deal doesn't dominate the totals.
 */
function readmeShots(): Shot[] {
  const hero = "/?round=pre_seed&round=seed&round=series_a";
  return [
    { path: hero, file: "hero-light.png", width: 1440, height: 900 },
    {
      path: hero,
      file: "hero-dark.png",
      width: 1440,
      height: 900,
      theme: "dark",
    },
    {
      path: `/companies/${company}`,
      file: "company-dark.png",
      width: 1440,
      height: 900,
      theme: "dark",
    },
    { path: "/?view=cards", file: "cards-light.png", width: 1440, height: 900 },
    {
      path: "/",
      file: "mobile-home-dark.png",
      width: 390,
      height: 844,
      theme: "dark",
      scale: 2,
    },
    {
      path: `/companies/${company}`,
      file: "mobile-company-light.png",
      width: 390,
      height: 844,
      scale: 2,
    },
  ];
}

const SHOTS: Shot[] = [
  ...readmeShots(),
  ...homeShots(),
  ...splitShots(),
  ...otherPageShots(),
  ...shellShots(),
  ...companyShots(company, "company-confirmed"),
  ...(newsOnlyCompany
    ? companyShots(newsOnlyCompany, "company-news-only")
    : []),
];

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({
        viewport: { width: shot.width, height: shot.height },
        colorScheme: shot.theme ?? "light",
        deviceScaleFactor: shot.scale ?? 1,
      });
      const response = await page.goto(`${base}${shot.path}`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok()) {
        throw new Error(`${shot.path} returned ${response?.status()}`);
      }
      // No page may scroll sideways (docs/design/design-system.md section 6).
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      if (overflow > 0) {
        console.error(
          `${shot.path} at ${shot.width}px scrolls sideways by ${overflow}px`,
        );
        process.exitCode = 1;
      }
      await page.screenshot({
        path: `docs/images/${shot.file}`,
        fullPage: shot.fullPage ?? false,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
