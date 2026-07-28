import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import cloudflareAccessPlugin from "./cloudflareAccess";

// Build a throwaway app with the plugin given explicit options, so these
// tests don't depend on (or mutate) global env/config.
async function appWith(opts: { teamDomain?: string; aud?: string }) {
  const app = Fastify();
  await app.register(cloudflareAccessPlugin, opts);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/projects", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("cloudflare access origin validation", () => {
  it("is inert (no-op) when unconfigured — the default", async () => {
    const app = await appWith({ teamDomain: "", aud: "" });
    // No CF header, yet the request sails through: the plugin added no hook.
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a request with no Access assertion when enabled", async () => {
    const app = await appWith({ teamDomain: "myteam.cloudflareaccess.com", aud: "aud-tag" });
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/cloudflare access/i);
    await app.close();
  });

  it("exempts health probes even when enabled", async () => {
    const app = await appWith({ teamDomain: "myteam.cloudflareaccess.com", aud: "aud-tag" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects an invalid (unverifiable) assertion when enabled", async () => {
    const app = await appWith({ teamDomain: "myteam.cloudflareaccess.com", aud: "aud-tag" });
    // A syntactically-plausible but unsigned/garbage token can't verify → 403,
    // not a crash. (Real verification against Cloudflare's JWKS is exercised
    // only once the env vars are set in a real deployment.)
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: { "cf-access-jwt-assertion": "not.a.valid.jwt" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
