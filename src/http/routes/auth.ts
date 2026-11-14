import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { PasskeyError } from "../../auth/passkeys";
import { safeEqual } from "../../auth/secrets";
import { createSession, deleteSession, SESSION_TTL_MS } from "../../auth/sessions";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";
import { hasSession, SESSION_COOKIE } from "../middleware";

const credential = z.object({ id: z.string().min(1), rawId: z.string().min(1), type: z.literal("public-key"), response: z.record(z.string(), z.unknown()) }).loose();
const optionsBody = z.object({ setupToken: z.string().optional() });
const registerBody = z.object({ setupToken: z.string().optional(), response: credential });
const loginBody = z.object({ response: credential });

function assertMayRegister(c: Context<Env>, setupToken: string | undefined) {
  const { passkeys, config } = c.var.deps;
  if (passkeys.count() > 0) {
    if (!hasSession(c)) throw new ApiError(401, "unauthenticated", "Sign in to add another passkey");
    return;
  }
  if (!safeEqual(setupToken, config.setupToken)) throw new ApiError(403, "setup_token_invalid", "A valid setup token is required for the first passkey");
}

async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : "Verification failed";
    throw new ApiError(400, error instanceof PasskeyError ? "passkey_rejected" : "verification_failed", message);
  }
}

function startSession(c: Context<Env>) {
  const { db, config, now } = c.var.deps;
  setCookie(c, SESSION_COOKIE, createSession(db, now()), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const authRoutes = new Hono<Env>()
  .get("/session", (c) => c.json({ authenticated: hasSession(c), setupRequired: c.var.deps.passkeys.count() === 0 }))
  .post("/register/options", async (c) => {
    const body = parse(optionsBody, await jsonBody(c));
    assertMayRegister(c, body.setupToken);
    return c.json(await c.var.deps.passkeys.registrationOptions());
  })
  .post("/register/verify", async (c) => {
    const body = parse(registerBody, await jsonBody(c));
    assertMayRegister(c, body.setupToken);
    const firstPasskey = c.var.deps.passkeys.count() === 0;
    await ceremony(() => c.var.deps.passkeys.verifyRegistration(body.response as unknown as RegistrationResponseJSON));
    if (firstPasskey) startSession(c);
    return c.json({ registered: true });
  })
  .post("/login/options", async (c) => c.json(await c.var.deps.passkeys.authenticationOptions()))
  .post("/login/verify", async (c) => {
    const body = parse(loginBody, await jsonBody(c));
    await ceremony(() => c.var.deps.passkeys.verifyAuthentication(body.response as unknown as AuthenticationResponseJSON));
    startSession(c);
    return c.json({ authenticated: true });
  })
  .post("/logout", (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) deleteSession(c.var.deps.db, id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ authenticated: false });
  });
