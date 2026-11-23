import { describe, expect, it } from "vitest";
import { hostOf, isSameSite, registrableDomain } from "./registrable-domain";

describe("registrableDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["https://www.acme.com/about?x=1", "acme.com"],
    ["HTTP://WWW.ACME.COM", "acme.com"],
    ["www.shop.acme.co.uk", "acme.co.uk"],
    ["acme.ltd.uk", "acme.ltd.uk"],
    ["https://acme.com.au/", "acme.com.au"],
    ["fal.ai", "fal.ai"],
    ["bit.bio", "bit.bio"],
    ["acme.github.io", "acme.github.io"],
    ["docs.acme.vercel.app", "acme.vercel.app"],
    ["acme.com.", "acme.com"],
    ["  acme.io  ", "acme.io"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("reads %s as %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["N/A"],
    ["none"],
    ["-"],
    ["co.uk"],
    ["github.io"],
    ["192.168.0.1"],
    ["http://[::1]/"],
    ["localhost"],
    ["info@acme.com"],
    ["mailto:info@acme.com"],
    ["ftp://acme.com"],
    ["https://user:pass@acme.com"],
    ["acme .com"],
    ["acme.123"],
    ["-acme.com"],
  ])("returns null for %j", (input) => {
    expect(registrableDomain(input)).toBeNull();
  });
});

describe("hostOf and isSameSite", () => {
  it("keeps subdomains in the host", () => {
    expect(hostOf("https://Blog.Acme.com/post")).toBe("blog.acme.com");
  });

  it("compares registrable domains", () => {
    expect(isSameSite("https://www.acme.co.uk/", "shop.acme.co.uk")).toBe(true);
    expect(isSameSite("acme.co.uk", "other.co.uk")).toBe(false);
    expect(isSameSite("a.github.io", "b.github.io")).toBe(false);
    expect(isSameSite("not a host", "not a host")).toBe(false);
  });
});
