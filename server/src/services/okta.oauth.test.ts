import { generateKeyPairSync, createVerify } from "crypto";
import { describe, expect, it } from "vitest";
import { buildClientAssertion, OKTA_SCOPE } from "./okta";

describe("Okta OAuth client_assertion (private_key_jwt)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const tokenUrl = "https://acme.okta.com/oauth2/v1/token";
  const clientId = "0oaEXAMPLECLIENTID";
  const now = 1_700_000_000;

  it("signs a verifiable RS256 JWT with the expected claims", () => {
    const jwt = buildClientAssertion(tokenUrl, clientId, privateKey, now);
    const [h, p, sig] = jwt.split(".");
    expect(h && p && sig).toBeTruthy();

    // Signature verifies against the matching public key.
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).end().verify(publicKey, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);

    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header.alg).toBe("RS256");
    expect(claims.iss).toBe(clientId);
    expect(claims.sub).toBe(clientId);
    expect(claims.aud).toBe(tokenUrl); // aud must be the token endpoint
    expect(claims.iat).toBe(now);
    expect(claims.exp).toBe(now + 300); // short-lived (5 min)
    expect(typeof claims.jti).toBe("string");
  });

  it("gives a fresh jti each call (replay protection)", () => {
    const a = buildClientAssertion(tokenUrl, clientId, privateKey, now).split(".")[1];
    const b = buildClientAssertion(tokenUrl, clientId, privateKey, now).split(".")[1];
    expect(JSON.parse(Buffer.from(a, "base64url").toString()).jti).not.toBe(
      JSON.parse(Buffer.from(b, "base64url").toString()).jti
    );
  });

  it("requests only the read-users scope", () => {
    expect(OKTA_SCOPE).toBe("okta.users.read");
  });

  it("throws on an invalid private key (caught by caller → null)", () => {
    expect(() => buildClientAssertion(tokenUrl, clientId, "not-a-key", now)).toThrow();
  });
});
