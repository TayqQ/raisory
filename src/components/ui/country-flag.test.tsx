import { readdirSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COUNTRY_REGIONS } from "@/lib/regions";
import { CountryFlag, FLAG_CODES } from "./country-flag";

describe("CountryFlag", () => {
  it("shows the flag for GB with the country name", () => {
    render(<CountryFlag countryCode="GB" />);
    const flag = screen.getByRole("img", { name: "United Kingdom" });
    expect(flag).toHaveAttribute("src", "/flags/gb.svg");
    expect(flag).toHaveAttribute("title", "United Kingdom");
    expect(flag).toHaveAttribute("width", "20");
    expect(flag).toHaveAttribute("height", "15");
    expect(flag).toHaveAttribute("loading", "lazy");
  });

  it("accepts lower-case codes", () => {
    render(<CountryFlag countryCode=" de " />);
    expect(screen.getByRole("img", { name: "Germany" })).toHaveAttribute(
      "src",
      "/flags/de.svg",
    );
  });

  it("is larger at the large size", () => {
    render(<CountryFlag countryCode="GB" size="lg" />);
    expect(screen.getByRole("img")).toHaveAttribute("width", "24");
  });

  it("has empty alt text when it sits beside the country name", () => {
    const { container } = render(<CountryFlag countryCode="FR" decorative />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back to the text code when there is no file", () => {
    render(<CountryFlag countryCode="zz9" />);
    expect(screen.getByText("ZZ9")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders nothing for null, undefined or blank", () => {
    const { container, rerender } = render(<CountryFlag countryCode={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountryFlag countryCode={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountryFlag countryCode="  " />);
    expect(container).toBeEmptyDOMElement();
  });
});

// To check the files after a change, run `pnpm test country-flag`. To add or
// refresh them, run `pnpm exec tsx scripts/build-flags.ts`.
describe("flag files", () => {
  const dir = path.join(process.cwd(), "public/flags");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".svg"))
    .map((name) => name.slice(0, -4));

  it("has a file for every country code the site can show", () => {
    const missing = Object.keys(COUNTRY_REGIONS)
      .map((code) => code.toLowerCase())
      .filter((code) => !files.includes(code));
    expect(missing).toEqual([]);
    expect(files).toContain("gb");
  });

  it("matches the list of codes in the component", () => {
    expect([...FLAG_CODES].sort()).toEqual([...files].sort());
  });
});
