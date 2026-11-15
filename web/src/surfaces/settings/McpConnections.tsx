import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useMcpConnections } from "../../api/queries";
import type { McpConnection } from "../../api/types";
import { fmtAgo } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { Button } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { Section } from "../../ui/Page";
import { SettingRow, SettingRows } from "../../ui/SettingRow";
import { Skeleton } from "../../ui/Skeleton";
import { describeError, EmptyState, ErrorState } from "../../ui/States";

const detail = (c: McpConnection) => [c.redirectHost, `connected ${fmtAgo(c.connectedAt)}`, c.lastUsedAt ? `used ${fmtAgo(c.lastUsedAt)}` : "not used yet"].join(" · ");

function ConnectionRow({ connection }: { connection: McpConnection }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => request(`/api/mcp/connections/${connection.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setOpen(false);
      showToast(`Disconnected ${connection.clientName}`);
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
    },
    onError: (e) => {
      setOpen(false);
      showToast(describeError(e), "problem");
    },
  });
  return (
    <SettingRow label={connection.clientName} hint={detail(connection)}>
      {(control) => (
        <div className="flex md:justify-end">
          <Button id={control.id} aria-describedby={control["aria-describedby"]} onClick={() => setOpen(true)}>
            Disconnect
          </Button>
          <Confirm open={open} onOpenChange={setOpen} title={`Disconnect ${connection.clientName}?`} action="Disconnect" danger busy={disconnect.isPending} onConfirm={() => disconnect.mutate()}>
            It loses access at once. To use it again, connect it from the app.
          </Confirm>
        </div>
      )}
    </SettingRow>
  );
}

/** Clients connected to `/mcp` through OAuth, each with Disconnect. Shown while OAuth is on, or while a connection is left. */
export function McpConnections({ oauthOn }: { oauthOn: boolean }) {
  const connections = useMcpConnections();
  const list = connections.data?.connections;
  if (!oauthOn && (!list || list.length === 0)) return null;
  return (
    <Section title="Connected apps">
      {connections.isError ? (
        <ErrorState error={connections.error} onRetry={() => void connections.refetch()} size="section" />
      ) : !list ? (
        <div aria-busy className="flex flex-col gap-3 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState size="inline" title="No apps connected" description="Apps you allow from claude.ai or another MCP client appear here." />
      ) : (
        <SettingRows>
          {list.map((c) => (
            <ConnectionRow key={c.id} connection={c} />
          ))}
        </SettingRows>
      )}
    </Section>
  );
}
