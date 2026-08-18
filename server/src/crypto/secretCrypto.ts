import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config";

/**
 * Encrypts small integration secrets (e.g. the BambooHR API key) so only
 * ciphertext is ever stored in the DB.
 *
 * Two providers:
 *  - KmsCrypto (production): Google Cloud KMS. The data key never exists on the
 *    box; encrypt/decrypt are calls gated by the VM's IAM identity, so a stolen
 *    DB dump, a SQL-injection read, or a leaked disk/.env reveals nothing
 *    usable. (A full live takeover of the running app can still ask KMS to
 *    decrypt — no scheme can prevent that for a key the app must actively use.)
 *  - LocalCrypto (dev/test/no-KMS): AES-256-GCM with a key derived from
 *    SESSION_SECRET. Protects a DB-only leak; used only when KMS_KEY_NAME is
 *    unset so the suite and local dev run without GCP.
 */
export interface SecretCrypto {
  readonly kind: "kms" | "local";
  encrypt(plaintext: string): Promise<string>; // -> opaque base64 token
  decrypt(token: string): Promise<string>;
}

class LocalCrypto implements SecretCrypto {
  readonly kind = "local" as const;
  private key = scryptSync(config.sessionSecret || "dev-secret", "captracker.secretbox.v1", 32);
  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return "local:" + Buffer.concat([iv, tag, ct]).toString("base64");
  }
  async decrypt(token: string): Promise<string> {
    const raw = Buffer.from(token.replace(/^local:/, ""), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }
}

class KmsCrypto implements SecretCrypto {
  readonly kind = "kms" as const;
  // Lazy client so @google-cloud/kms is only loaded when KMS is actually used.
  private clientPromise: Promise<{ encrypt: Function; decrypt: Function }> | null = null;
  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import("@google-cloud/kms").then((m) => new m.KeyManagementServiceClient());
    }
    return this.clientPromise;
  }
  async encrypt(plaintext: string): Promise<string> {
    const c = await this.client();
    const [res] = await c.encrypt({ name: config.kmsKeyName, plaintext: Buffer.from(plaintext, "utf8") });
    return "kms:" + Buffer.from(res.ciphertext as Uint8Array).toString("base64");
  }
  async decrypt(token: string): Promise<string> {
    const c = await this.client();
    const [res] = await c.decrypt({ name: config.kmsKeyName, ciphertext: Buffer.from(token.replace(/^kms:/, ""), "base64") });
    return Buffer.from(res.plaintext as Uint8Array).toString("utf8");
  }
}

let instance: SecretCrypto | null = null;
export function secretCrypto(): SecretCrypto {
  if (!instance) instance = config.kmsKeyName ? new KmsCrypto() : new LocalCrypto();
  return instance;
}
