import { describe, expect, it } from "vitest";
import { buildAutoIpLinkedFingerprintBanRows } from "../src/lib/ban";

describe("IP-linked fingerprint auto-ban", () => {
  it("builds unique rows and normalizes fingerprints", () => {
    const rows = buildAutoIpLinkedFingerprintBanRows({
      fingerprints: [" fp-a ", "fp-a", "", "fp-b"],
      ip: "1.2.3.4",
      ipBanReason: "IP banned by admin",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fingerprint)).toEqual(["fp-a", "fp-b"]);
    expect(rows[0]?.ip_address).toBe("1.2.3.4");
    expect(rows[0]?.reason).toContain("IP banned by admin");
    expect(rows[0]?.banned_by).toBe("system:auto-ip-link");
  });

  it("omits unknown IP and uses default reason", () => {
    const rows = buildAutoIpLinkedFingerprintBanRows({
      fingerprints: ["fp-c"],
      ip: "unknown",
      ipBanReason: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip_address).toBeNull();
    expect(rows[0]?.reason).toBe("Auto-ban by IP association with a banned IP.");
  });

  it("returns empty when no valid fingerprints", () => {
    const rows = buildAutoIpLinkedFingerprintBanRows({
      fingerprints: ["", "   "],
      ip: "1.1.1.1",
      ipBanReason: "x",
    });

    expect(rows).toHaveLength(0);
  });
});