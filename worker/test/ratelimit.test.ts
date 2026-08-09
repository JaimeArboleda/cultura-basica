import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { permitir } from "../src/ratelimit";

describe("permitir", () => {
  it("permite hasta el límite configurado y bloquea a partir de ahí", async () => {
    const envConLimiteBajo = { ...env, RATE_LIMIT_MAX: "2" };
    const ip = "203.0.113.1";

    expect(await permitir(envConLimiteBajo, ip)).toBe(true);
    expect(await permitir(envConLimiteBajo, ip)).toBe(true);
    expect(await permitir(envConLimiteBajo, ip)).toBe(false);
  });

  it("no comparte cupo entre IPs distintas", async () => {
    const envConLimiteBajo = { ...env, RATE_LIMIT_MAX: "1" };
    expect(await permitir(envConLimiteBajo, "203.0.113.10")).toBe(true);
    expect(await permitir(envConLimiteBajo, "203.0.113.11")).toBe(true);
  });
});
