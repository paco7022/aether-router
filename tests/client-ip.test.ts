import { describe, expect, it } from "vitest";
import { getClientIp } from "../src/lib/client-ip";

describe("getClientIp", () => {
  it("prefers Cloudflare edge headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "1.2.3.4, 198.51.100.20",
    });

    expect(getClientIp(headers)).toBe("203.0.113.10");
  });

  it("falls back to the closest trusted forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 198.51.100.20",
    });

    expect(getClientIp(headers)).toBe("198.51.100.20");
  });
});
