import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts throws at import time (it validates env vars as a side effect of
// module load), so exercising its boot-time checks means re-importing it
// fresh with a mutated process.env each time -- vi.resetModules() clears the
// module registry so the next import() re-runs config.ts's top-level code
// instead of returning the already-validated cached instance.
const ORIGINAL_ENV = { ...process.env };

const BASE_ENV = {
  NODE_ENV: "production",
  SESSION_SECRET: "test-secret",
  DEV_AUTH: "false",
  OIDC_ISSUER_URL: "https://idp.example.test",
  OIDC_CLIENT_ID: "abc123",
  OIDC_CLIENT_SECRET: "shh",
  OIDC_REDIRECT_URI: "https://relay.example.test/auth/oidc/callback",
};

async function loadConfig(overrides: Record<string, string>) {
  process.env = { ...ORIGINAL_ENV, ...BASE_ENV, ...overrides };
  vi.resetModules();
  return import("./config");
}

describe("config — boot-time hard-fails (§7/§11 step 6)", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses to boot with DEV_AUTH=true and NODE_ENV=production", async () => {
    await expect(loadConfig({ DEV_AUTH: "true" })).rejects.toThrow(/DEV_AUTH=true is not allowed/);
  });

  it("refuses to boot with DEV_AUTH off and the issuer URL missing", async () => {
    await expect(loadConfig({ OIDC_ISSUER_URL: "" })).rejects.toThrow(/OIDC_ISSUER_URL.*must be set/);
  });

  it("refuses to boot with DEV_AUTH off and the client secret missing", async () => {
    await expect(loadConfig({ OIDC_CLIENT_SECRET: "" })).rejects.toThrow(/OIDC_CLIENT_SECRET.*must be set/);
  });

  it("reports every missing OIDC var at once, not just the first", async () => {
    await expect(
      loadConfig({ OIDC_ISSUER_URL: "", OIDC_CLIENT_ID: "", OIDC_CLIENT_SECRET: "", OIDC_REDIRECT_URI: "" })
    ).rejects.toThrow(/OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI/);
  });

  it("boots fine with DEV_AUTH off and every OIDC var present", async () => {
    const { config } = await loadConfig({});
    expect(config.devAuth).toBe(false);
    expect(config.oidcIssuerUrl).toBe("https://idp.example.test");
  });

  it("boots fine with DEV_AUTH on and no OIDC vars at all (local dev)", async () => {
    const { config } = await loadConfig({
      DEV_AUTH: "true",
      NODE_ENV: "development",
      OIDC_ISSUER_URL: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
      OIDC_REDIRECT_URI: "",
    });
    expect(config.devAuth).toBe(true);
  });

  it("refuses to boot without SESSION_SECRET, regardless of auth mode", async () => {
    await expect(loadConfig({ SESSION_SECRET: "" })).rejects.toThrow(/SESSION_SECRET must be set/);
  });
});
