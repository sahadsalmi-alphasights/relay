import { describe, expect, it } from "vitest";
import { secretCrypto } from "./secretCrypto";

describe("secretCrypto (local fallback — no KMS in tests)", () => {
  it("round-trips a secret and never returns plaintext in the token", async () => {
    const sc = secretCrypto();
    expect(sc.kind).toBe("local"); // KMS_KEY_NAME unset in tests
    const secret = "bamboo-api-key-abcd1234";
    const token = await sc.encrypt(secret);
    expect(token).not.toContain(secret); // ciphertext, not plaintext
    expect(token.startsWith("local:")).toBe(true);
    expect(await sc.decrypt(token)).toBe(secret);
  });

  it("produces a different token each time (random IV) but decrypts to the same value", async () => {
    const sc = secretCrypto();
    const a = await sc.encrypt("same");
    const b = await sc.encrypt("same");
    expect(a).not.toBe(b);
    expect(await sc.decrypt(a)).toBe("same");
    expect(await sc.decrypt(b)).toBe("same");
  });

  it("rejects a tampered token", async () => {
    const sc = secretCrypto();
    const token = await sc.encrypt("secret");
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(sc.decrypt(tampered)).rejects.toBeTruthy();
  });
});
