import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../api/client";
import { useSession } from "../api/queries";
import { passkeyProblem, registerPasskey, signInWithPasskey } from "../lib/passkey";
import { Lockup } from "../ui/Brand";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { ArrowLeftIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { useDocumentTitle } from "../ui/Page";

/** The fixed-height card every step sits in, so the button never jumps between steps. */
function Card({ step, title, children, footer }: { step?: string; title: string; children: ReactNode; footer: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-[340px] flex-col gap-6 rounded-xl bg-page p-6 shadow-panel phone:min-h-0 phone:flex-1 phone:bg-transparent phone:p-0 phone:[box-shadow:none]">
      <div className="flex flex-col gap-1">
        {step && <p className="text-caption text-secondary">{step}</p>}
        <h1 className="font-serif text-title text-balance text-primary">{title}</h1>
      </div>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">{footer}</div>
    </div>
  );
}

function NoToken({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  return (
    <Card
      title="Set up encore"
      footer={
        <Button variant="primary" busy={checking} busyLabel="Checking" onClick={onCheck} className="md:ml-auto">
          Check again
        </Button>
      }
    >
      <p className="text-body text-pretty">
        Set <strong className="font-medium">SETUP_TOKEN</strong> in the server’s environment, 24 characters or more, and restart encore. You enter it here once to create your passkey.
      </p>
    </Card>
  );
}

function TokenStep({ onVerified, onComplete }: { onVerified: (token: string) => void; onComplete: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request("/api/auth/setup/verify", { json: { setupToken: token } });
      onVerified(token);
    } catch (err) {
      if (err instanceof ApiError && err.code === "setup_complete") onComplete();
      else setError(passkeyProblem(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="contents">
      <Card
        step="Step 1 of 2"
        title="Enter the setup token"
        footer={
          <Button type="submit" variant="primary" busy={busy} busyLabel="Checking" disabled={token.trim().length === 0} className="md:ml-auto">
            Continue
          </Button>
        }
      >
        <Field label="Setup token" hint="The SETUP_TOKEN value from the server’s environment." error={error}>
          {(props) => <Input {...props} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />}
        </Field>
      </Card>
    </form>
  );
}

function PasskeyStep({ token, onBack, supported }: { token: string; onBack: () => void; supported: boolean }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(token);
      navigate("/setup");
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(passkeyProblem(err));
      setBusy(false);
    }
  };
  return (
    <Card
      step="Step 2 of 2"
      title="Create your passkey"
      footer={
        <>
          <Button variant="ghost" icon={ArrowLeftIcon} onClick={onBack} disabled={busy} className="md:-ml-3">
            Back
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Waiting for passkey" disabled={!supported} onClick={() => void create()}>
            Create passkey
          </Button>
        </>
      }
    >
      <p className="text-body text-pretty">You sign in to encore with this passkey.</p>
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}

function SignInStep({ supported, notice }: { supported: boolean; notice?: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(passkeyProblem(err));
      setBusy(false);
    }
  };
  return (
    <Card
      title="Sign in"
      footer={
        <Button variant="primary" size="lg" busy={busy} busyLabel="Waiting for passkey" disabled={!supported} onClick={() => void signIn()} className="w-full">
          Sign in with passkey
        </Button>
      }
    >
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}

/** Outside the shell: first-run token and passkey, or sign in with the passkey. */
export function SignIn() {
  const session = useSession();
  const supported = browserSupportsWebAuthn();
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const s = session.data;
  if (!s) return null;
  const content = !s.setupRequired ? (
    <SignInStep supported={supported} notice={notice} />
  ) : !s.setupTokenConfigured ? (
    <NoToken onCheck={() => void session.refetch()} checking={session.isFetching} />
  ) : token === null ? (
    <TokenStep
      onVerified={setToken}
      onComplete={() => {
        setNotice("A passkey already exists. Sign in with it.");
        void session.refetch();
      }}
    />
  ) : (
    <PasskeyStep token={token} supported={supported} onBack={() => setToken(null)} />
  );
  return (
    <main className="flex min-h-dvh flex-col items-center bg-shell px-4 pt-12 pb-4 md:justify-center md:py-16">
      <div className="flex w-full max-w-[360px] flex-col gap-8 phone:flex-1">
        <Lockup size={32} />
        {!supported && <Notice tone="warning">This browser cannot use passkeys. Open encore in a current version of Safari, Chrome, Firefox or Edge.</Notice>}
        {content}
      </div>
    </main>
  );
}
