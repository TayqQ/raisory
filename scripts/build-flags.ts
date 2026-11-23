import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Usage: pnpm exec tsx scripts/build-flags.ts
// Copies the 3:2 SVG flags from the `country-flag-icons` dev dependency into
// public/flags/<code>.svg (lower-case ISO 3166-1 alpha-2) and keeps its
// licence beside them. The output is committed, so the site has no runtime
// dependency on the package. Re-run it only when you bump the package.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules/country-flag-icons");
const target = path.join(root, "public/flags");

async function main() {
  const flagDir = path.join(source, "3x2");
  const files = (await readdir(flagDir)).filter((name) =>
    /^[A-Z]{2}\.svg$/.test(name),
  );
  if (files.length === 0) throw new Error(`No SVG flags found in ${flagDir}`);

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const file of files) {
    await copyFile(
      path.join(flagDir, file),
      path.join(target, file.toLowerCase()),
    );
  }

  const pkg = JSON.parse(
    await readFile(path.join(source, "package.json"), "utf8"),
  ) as { version: string };
  const licence = await readFile(path.join(source, "LICENSE"), "utf8");
  await writeFile(
    path.join(target, "LICENSE"),
    `Flags in this folder come from country-flag-icons ${pkg.version} (3x2 SVGs),\n` +
      `https://gitlab.com/catamphetamine/country-flag-icons, copied unchanged by\n` +
      `scripts/build-flags.ts. The package is MIT-licensed:\n\n${licence}`,
  );
  console.log(`Wrote ${files.length} flags to public/flags`);
}

void main();
