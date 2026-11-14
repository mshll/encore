import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretUnreadableError extends Error {}

/** AES-256-GCM with a key derived from SECRETS_KEY. Output: `v1.<iv>.<ciphertext>.<tag>`, base64url. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, "encore", "settings-secrets-v1", 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv, body, cipher.getAuthTag()].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
  }

  open(sealed: string): string {
    const [version, iv, body, tag] = sealed.split(".");
    if (version !== VERSION || iv === undefined || body === undefined || tag === undefined) throw new SecretUnreadableError("Unknown secret format");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretUnreadableError("Secret was sealed with a different SECRETS_KEY");
    }
  }
}
