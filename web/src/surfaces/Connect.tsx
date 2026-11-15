import { useMutation } from "@tanstack/react-query";
import { request } from "../api/client";
import { useMcpConsent } from "../api/queries";
import type { McpConsentDecision, McpConsentRequest } from "../api/types";
import { AppLink } from "../ui/AppLink";
import { Button, buttonClass } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { Skeleton } from "../ui/Skeleton";
import { describeError } from "../ui/States";
import { AuthPage, Card } from "./SignIn";

const toolList = (names: readonly string[]) => names.map((n) => n.replaceAll("_", " ")).join(", ");

function Permission({ title, tools }: { title: string; tools: readonly string[] }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-body text-primary">{title}</p>
      <p className="text-caption text-secondary text-pretty">{toolList(tools)}</p>
    </li>
  );
}

function Consent({ id, request: r }: { id: string; request: McpConsentRequest }) {
  const decide = useMutation({
    mutationFn: (decision: "allow" | "deny") => request<McpConsentDecision>(`/api/mcp/requests/${encodeURIComponent(id)}`, { json: { decision } }),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });
  const pending = decide.isPending || decide.isSuccess;
  const choice = decide.variables;
  return (
    <Card
      title={`Allow ${r.clientName} to use encore?`}
      footer={
        <>
          <Button variant="ghost" busy={pending && choice === "deny"} busyLabel="Denying" disabled={pending} onClick={() => decide.mutate("deny")} className="md:-ml-3">
            Deny
          </Button>
          <Button variant="primary" busy={pending && choice === "allow"} busyLabel="Allowing" disabled={pending} onClick={() => decide.mutate("allow")}>
            Allow
          </Button>
        </>
      }
    >
      {r.loopback ? (
        <p className="text-body text-pretty">
          You go back to a program on this computer (<strong className="font-medium break-all">{r.redirectHost}</strong>). Allow it only if you started connecting from an app here.
        </p>
      ) : (
        <p className="text-body text-pretty">
          You go back to <strong className="font-medium break-all">{r.redirectHost}</strong> after you choose.
        </p>
      )}
      <div className="flex flex-col gap-3">
        <p className="text-body-sm font-medium text-primary">It will be able to</p>
        <ul className="flex flex-col gap-3">
          <Permission title="Read your listening" tools={r.tools.read} />
          <Permission title="Play songs in Spotify" tools={r.tools.playback} />
        </ul>
      </div>
      {decide.isError && <Notice tone="danger">{describeError(decide.error)}</Notice>}
    </Card>
  );
}

/** The OAuth consent for an MCP client, outside the shell. `/oauth/authorize` sends the browser here. */
export function Connect({ id }: { id: string }) {
  const consent = useMcpConsent(id);
  if (consent.isError)
    return (
      <AuthPage>
        <Card title="Connect an app" footer={null}>
          <Notice tone="danger" onRetry={() => void consent.refetch()}>
            {describeError(consent.error)}
          </Notice>
        </Card>
      </AuthPage>
    );
  if (consent.isPending)
    return (
      <AuthPage>
        <div aria-busy className="flex min-h-[340px] flex-col gap-6 rounded-xl bg-page p-6 shadow-panel phone:min-h-0 phone:flex-1 phone:bg-transparent phone:p-0 phone:[box-shadow:none]">
          <Skeleton className="h-7 w-4/5" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </AuthPage>
    );
  if (consent.data === null)
    return (
      <AuthPage>
        <Card
          title="This request has expired"
          footer={
            <AppLink to="/" className={buttonClass({ className: "md:ml-auto" })}>
              Open encore
            </AppLink>
          }
        >
          <p className="text-body text-pretty">Start connecting again from the app.</p>
        </Card>
      </AuthPage>
    );
  return (
    <AuthPage>
      <Consent id={id} request={consent.data} />
    </AuthPage>
  );
}
