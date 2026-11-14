import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, request } from "../api/client";
import { Lockup } from "../ui/Brand";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { useDocumentTitle } from "../ui/Page";

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "setup_token_invalid") return "That setup token is not the one on the server. Check SETUP_TOKEN in its environment.";
    if (error.code === "passkey_rejected") return "This passkey is not registered with encore. Pick the one you created for it.";
    return error.message;
  }
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_CEREMONY_ABORTED" || error.name === "NotAllowedError") return "The passkey prompt was closed before it finished.";
    return error.message;
  }
  if (error instanceof Error && error.name === "NotAllowedError") return "The passkey prompt was closed before it finished.";
  if (error instanceof TypeError) return "Could not reach the server.";
  return error instanceof Error ? error.message : "Sign in failed.";
}

export function SignIn({ setupRequired }: { setupRequired: boolean }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();
  useDocumentTitle(setupRequired ? "Create your passkey" : "Sign in");

  const run = async (ceremony: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await ceremony();
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const optionsJSON = await request<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON });
      await request("/api/auth/login/verify", { json: { response } });
    });

  const register = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const optionsJSON = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/register/options", { json: { setupToken: token } });
      const response = await startRegistration({ optionsJSON });
      await request("/api/auth/register/verify", { json: { setupToken: token, response } });
    });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-shell px-(--gutter) py-16">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Lockup size={32} />
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-title">{setupRequired ? "Create your passkey" : "Sign in"}</h1>
          {setupRequired && <p className="text-secondary text-pretty">Enter the SETUP_TOKEN value from the server’s environment.</p>}
        </div>
        {!supported ? (
          <p role="alert" className="text-danger">
            This browser does not support passkeys.
          </p>
        ) : setupRequired ? (
          <form onSubmit={register} className="flex flex-col gap-4">
            <Field label="Setup token">
              {(props) => <Input {...props} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} required />}
            </Field>
            <Button type="submit" variant="accent" size="lg" busy={busy} busyLabel="Waiting for passkey" disabled={token.length === 0}>
              Create passkey
            </Button>
          </form>
        ) : (
          <Button variant="accent" size="lg" busy={busy} busyLabel="Waiting for passkey" onClick={() => void signIn()}>
            Sign in with passkey
          </Button>
        )}
        {error && (
          <p role="alert" className="text-danger text-pretty">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
