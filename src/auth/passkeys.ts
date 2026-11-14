import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { eq, sql } from "drizzle-orm";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { passkeys } from "../db/schema";

type Ceremony = "register" | "login";

const challengeTtlMs = 5 * 60_000;
const ownerUserId = new TextEncoder().encode("encore-owner");

export class PasskeyError extends Error {}

export class Passkeys {
  private readonly challenges = new Map<string, { ceremony: Ceremony; expiresAt: number }>();

  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, "rpId" | "publicBaseUrl">,
    private readonly now: () => number = Date.now,
  ) {}

  count(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(passkeys).get()?.n ?? 0;
  }

  async registrationOptions() {
    const existing = this.db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).all();
    const options = await generateRegistrationOptions({
      rpName: "encore",
      rpID: this.config.rpId,
      userName: "owner",
      userID: ownerUserId,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    this.remember(options.challenge, "register");
    return options;
  }

  async verifyRegistration(response: RegistrationResponseJSON) {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => this.consume(challenge, "register"),
      expectedOrigin: this.config.publicBaseUrl,
      expectedRPID: this.config.rpId,
      requireUserVerification: false,
    });
    if (!result.verified) throw new PasskeyError("Registration could not be verified");
    const { credential } = result.registrationInfo;
    this.db
      .insert(passkeys)
      .values({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ?? null,
        createdAt: this.now(),
      })
      .run();
  }

  async authenticationOptions() {
    const options = await generateAuthenticationOptions({ rpID: this.config.rpId, userVerification: "preferred" });
    this.remember(options.challenge, "login");
    return options;
  }

  async verifyAuthentication(response: AuthenticationResponseJSON) {
    const stored = this.db.select().from(passkeys).where(eq(passkeys.id, response.id)).get();
    if (!stored) throw new PasskeyError("Unknown passkey");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => this.consume(challenge, "login"),
      expectedOrigin: this.config.publicBaseUrl,
      expectedRPID: this.config.rpId,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports ?? undefined,
      },
      requireUserVerification: false,
    });
    if (!result.verified) throw new PasskeyError("Authentication could not be verified");
    this.db
      .update(passkeys)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: this.now() })
      .where(eq(passkeys.id, stored.id))
      .run();
  }

  private remember(challenge: string, ceremony: Ceremony) {
    const now = this.now();
    for (const [key, value] of this.challenges) if (value.expiresAt < now) this.challenges.delete(key);
    this.challenges.set(challenge, { ceremony, expiresAt: now + challengeTtlMs });
  }

  private consume(challenge: string, ceremony: Ceremony): boolean {
    const entry = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    return Boolean(entry && entry.ceremony === ceremony && entry.expiresAt >= this.now());
  }
}
