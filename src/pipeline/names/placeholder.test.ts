import { describe, expect, it } from "vitest";
import { isPlaceholderCompanyName } from "./placeholder";

const PLACEHOLDERS = [
  "startup",
  "Startup",
  "start-up",
  "scale-up",
  "Scaleup",
  "the company",
  "The Company",
  "a London startup",
  "a London-based start-up",
  "London startup",
  "a Manchester fintech",
  "fintech",
  "Healthtech",
  "insurtech",
  "AI",
  "unnamed",
  "Unnamed company",
  "stealth startup",
  "a stealth-mode startup",
  "platform",
  "the platform",
  "an AI startup",
  "a UK fintech",
  "the firm",
  "Monzo-backed startup",
  "a new company",
  "early-stage startup",
  "undisclosed",
  "the startup's",
  "  ",
  "",
];

const REAL_NAMES = [
  "Acorda",
  "Startup Genome",
  "Fintech Farm",
  "Platform.sh",
  "The Hut Group",
  "The Very Group",
  "Tech Nation",
  "Starling Bank",
  "OpenAI",
  "Monzo",
  "Stealth Worker",
  "Unknown Worlds",
  "HealthTech Ventures",
  "Software AG",
  "AppFolio",
  "Startupbootcamp",
  "Founders Factory",
  "The Engine",
  "Company House Ltd",
  "Business Cloud Media",
  "deliveroo",
  "hello fresh",
  "Example Robotics",
  "Northwind Labs",
  "AI Superior",
  "Firmable",
];

describe("isPlaceholderCompanyName", () => {
  it.each(PLACEHOLDERS)("flags %j", (name) => {
    expect(isPlaceholderCompanyName(name)).toBe(true);
  });

  it.each(REAL_NAMES)("keeps %j", (name) => {
    expect(isPlaceholderCompanyName(name)).toBe(false);
  });

  it("has at least 20 cases each way", () => {
    expect(PLACEHOLDERS.length).toBeGreaterThanOrEqual(20);
    expect(REAL_NAMES.length).toBeGreaterThanOrEqual(20);
  });
});
