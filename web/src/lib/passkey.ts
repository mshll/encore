import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { ApiError, request } from "../api/client";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

/** Registers a passkey. The first one needs the server's setup token and signs you in; later ones need a session. */
export async function registerPasskey(setupToken?: string): Promise<void> {
  const optionsJSON = await request<RegistrationOptions>("/api/auth/register/options", { json: { setupToken } });
  const response = await startRegistration({ optionsJSON });
  await request("/api/auth/register/verify", { json: { setupToken, response } });
}

export async function signInWithPasskey(): Promise<void> {
  const optionsJSON = await request<AuthenticationOptions>("/api/auth/login/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON });
  await request("/api/auth/login/verify", { json: { response } });
}

export const isCancelled = (error: unknown) =>
  (error instanceof WebAuthnError && error.code === "ERROR_CEREMONY_ABORTED") || (error instanceof Error && error.name === "NotAllowedError");

/** What went wrong in a passkey ceremony or its requests, as one sentence. */
export function passkeyProblem(error: unknown): string {
  if (isCancelled(error)) return "The passkey prompt closed before it finished. Try again.";
  if (error instanceof ApiError) {
    switch (error.code) {
      case "setup_token_invalid":
        return "That is not the setup token on the server.";
      case "rate_limited":
        return "Too many attempts. Wait a minute, then try again.";
      case "passkey_rejected":
        return "encore does not know this passkey. Pick the one you created for it.";
      case "verification_failed":
        return "The passkey could not be verified. Try again.";
      case "unauthenticated":
        return "Your session ended. Sign in again to add a passkey.";
      default:
        return error.message;
    }
  }
  if (error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already holds a passkey for encore.";
  if (error instanceof TypeError) return "encore did not answer. Check that the server is running.";
  return error instanceof Error ? error.message : "The passkey step failed.";
}
