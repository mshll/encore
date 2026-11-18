import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ApiError, request } from "../../api/client";
import { useBatches, usePlan, useStatus } from "../../api/queries";
import type { Batch, ItemStatus, PlanAction, PlanDetail, PlanItem } from "../../api/types";
import { useAi } from "../../lib/ai";
import { fmtInt, fmtMonth } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Confirm } from "../../ui/Dialog";
import { BroomIcon, ChatCircleTextIcon } from "../../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MoreTrigger } from "../../ui/Menu";
import { Notice } from "../../ui/Notice";
import { dimWhile, Page, PageHeader, Section, useDocumentTitle, type HeaderAction } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { TabList, TabsRoot } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import { describeError, EmptyState, ErrorState } from "../../ui/States";
import { BatchStatus, useBatchCache, useBatchEndings, useUndo } from "./batch";
import { useChat } from "../../chat/state";
import { SongLine } from "./rows";
import { changes, consequences, groupTitle, SOURCE_LABEL, songs } from "./words";

const TAKE_OUT: PlanAction[] = ["archive", "remove"];
const STATUS_LABEL: Record<ItemStatus, string> = { open: "To review", applied: "Applied", skipped: "Skipped", dismissed: "Dismissed" };

type Group = PlanDetail["groups"][number];
const groupKey = (action: PlanAction, where: PlanItem["where"]) => `${action}:${where.kind === "playlist" ? where.id : "liked"}`;
const whereParam = (where: PlanItem["where"]) => (where.kind === "playlist" ? where.id : "liked");

type Selection = number[] | "all" | { action: PlanAction; where: string };

function usePlanEdits(id: number) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["library"], predicate: (q) => q.queryKey[1] === "plan" || q.queryKey[1] === "plans" });
  /** Ticks show at once; the server's counts follow on the refetch. */
  const mark = (match: (i: PlanItem) => boolean, included: boolean) =>
    queryClient.setQueryData<InfiniteData<PlanDetail>>(["library", "plan", id, "open"], (old) =>
      old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (match(i) ? { ...i, included } : i)) })) },
    );
  const send = async (path: string, body: unknown) => {
    try {
      await request(path, { method: path.endsWith("/items") ? "PATCH" : "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      return true;
    } catch (error) {
      showToast(describeError(error), "problem");
      return false;
    } finally {
      await refresh();
    }
  };
  return {
    tick: (ids: Selection, included: boolean, match: (i: PlanItem) => boolean) => {
      mark(match, included);
      return send(`/api/library/plans/${id}/items`, { ids, included });
    },
    switchTo: (ids: Selection, action: "archive" | "remove") => send(`/api/library/plans/${id}/items`, { ids, action }),
    dismiss: (ids: Selection) => send(`/api/library/plans/${id}/dismiss`, { ids }),
    restore: (ids: number[] | "all") => send(`/api/library/plans/${id}/restore`, { ids }),
  };
}

function GroupHeader({ group, editable, edits }: { group: Group; editable: boolean; edits: ReturnType<typeof usePlanEdits> }) {
  const selection = { action: group.action, where: whereParam(group.where) };
  const inGroup = (i: PlanItem) => groupKey(i.action, i.where) === groupKey(group.action, group.where);
  const all = group.selected === group.items;
  return (
    <div className="flex min-h-(--control-h-lg) flex-wrap items-center gap-x-3 gap-y-2 pt-4 first:pt-0">
      {editable && (
        <Checkbox
          className="phone:mr-0"
          label={`Tick every song: ${groupTitle(group.action, group.where)}`}
          checked={all}
          indeterminate={group.selected > 0 && !all}
          onChange={() => void edits.tick(selection, !all, inGroup)}
        />
      )}
      <h3 className="min-w-40 flex-1 font-medium text-pretty text-primary">{groupTitle(group.action, group.where)}</h3>
      <span className="text-secondary tabular">{editable ? `${fmtInt(group.selected)} of ${fmtInt(group.items)}` : fmtInt(group.items)}</span>
      {editable && TAKE_OUT.includes(group.action) && (
        <Select<"archive" | "remove">
          label="Archive or remove"
          value={group.action as "archive" | "remove"}
          onChange={(action) => action !== group.action && void edits.switchTo(selection, action)}
          options={[
            { value: "archive", label: "Archive" },
            { value: "remove", label: "Remove" },
          ]}
          className="h-(--control-h-sm) w-28 text-body-sm"
        />
      )}
    </div>
  );
}

/** The facts behind a song, for reasons Claude wrote in its own words. */
function evidenceLine(e: PlanItem["evidence"]): string {
  const when = e.lastPlayed ? `last played ${fmtMonth(e.lastPlayed.slice(0, 7))}` : "never played";
  return `${when[0]!.toUpperCase()}${when.slice(1)}, ${fmtInt(e.listens)} ${e.listens === 1 ? "listen" : "listens"}`;
}

function ItemRow({ item, status, edits, evidence }: { item: PlanItem; status: ItemStatus; edits: ReturnType<typeof usePlanEdits>; evidence: boolean }) {
  const editable = status === "open";
  const other = item.action === "archive" ? "remove" : "archive";
  return (
    <SongLine
      name={item.evidence.name}
      artist={item.evidence.artist}
      art={item.evidence.albumArtUrl}
      detail={evidence ? `${item.reason}. ${evidenceLine(item.evidence)}` : item.reason}
      muted={editable && !item.included}
      lead={editable && <Checkbox label={`Include ${item.evidence.name}`} checked={item.included} onChange={(v) => void edits.tick([item.id], v, (i) => i.id === item.id)} />}
      end={
        editable ? (
          <MenuRoot>
            <MoreTrigger label={`More for ${item.evidence.name}`} />
            <MenuPopup>
              {TAKE_OUT.includes(item.action) && <MenuItem onClick={() => void edits.switchTo([item.id], other)}>{other === "archive" ? "Archive instead" : "Remove instead"}</MenuItem>}
              <MenuItem onClick={() => void edits.dismiss([item.id])}>Dismiss</MenuItem>
            </MenuPopup>
          </MenuRoot>
        ) : status === "dismissed" ? (
          <Button size="sm" variant="ghost" onClick={() => void edits.restore([item.id])}>
            Restore
          </Button>
        ) : undefined
      }
    />
  );
}

function Items({ id, status, plan }: { id: number; status: ItemStatus; plan: PlanDetail }) {
  const q = usePlan(id, status);
  const edits = usePlanEdits(id);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pages = q.data?.pages;
  if (!pages || pages[0]?.page.status !== status) return <RowSkeleton rows={8} />;
  const items = pages.flatMap((p) => p.items);
  const groups = new Map(pages[0]!.groups.map((g) => [groupKey(g.action, g.where), g]));
  const editable = status === "open" && plan.status === "open";
  if (items.length === 0)
    return (
      <EmptyState
        title={status === "open" ? (plan.counts.applied > 0 ? "Everything in this plan is applied" : "Nothing left to review") : `Nothing ${STATUS_LABEL[status].toLowerCase()}`}
      />
    );
  let last = "";
  return (
    <div className={dimWhile(q.isFetching && !q.isFetchingNextPage)}>
      <ul aria-label={STATUS_LABEL[status]} className="flex flex-col">
        {items.map((item) => {
          const key = groupKey(item.action, item.where);
          const head = key !== last ? groups.get(key) : undefined;
          last = key;
          return (
            <Fragment key={item.id}>
              {head && (
                <li className="list-none">
                  <GroupHeader group={head} editable={editable} edits={edits} />
                </li>
              )}
              <ItemRow item={item} status={editable ? "open" : status === "open" ? "applied" : status} edits={edits} evidence={plan.source === "claude" || plan.source === "standing"} />
            </Fragment>
          );
        })}
      </ul>
      {q.hasNextPage && (
        <Button className="mt-4" busy={q.isFetchingNextPage} busyLabel="Loading" onClick={() => void q.fetchNextPage()}>
          Show more ({fmtInt(items.length)} of {fmtInt(pages[0]!.page.total)})
        </Button>
      )}
    </div>
  );
}

function ApplyButton({ plan, latest, connected }: { plan: PlanDetail; latest: Batch | undefined; connected: boolean }) {
  const replace = useBatchCache();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = plan.status === "open" ? plan.groups.reduce((n, g) => n + g.selected, 0) : 0;
  const running = Boolean(plan.runningBatchId) || (latest !== undefined && (latest.status === "running" || latest.undo.status === "running"));
  const lines = consequences(plan.groups.map((g) => ({ action: g.action, where: g.where, n: g.selected })));
  const apply = async () => {
    setBusy(true);
    try {
      const { batch } = await request<{ batch: Batch }>(`/api/library/plans/${plan.id}/apply`, { method: "POST" });
      await replace(batch);
      setOpen(false);
    } catch (error) {
      showToast(error instanceof ApiError && error.code === "batch_running" ? "Another change is still being applied or undone. Try again when it ends." : describeError(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  if (plan.status !== "open") return null;
  return (
    <>
      <Button variant="primary" disabled={selected === 0 || running || !connected} onClick={() => setOpen(true)}>
        Apply {changes(selected)}
      </Button>
      <Confirm open={open} onOpenChange={setOpen} title={`Apply ${changes(selected)}?`} action="Apply" busy={busy} onConfirm={() => void apply()}>
        {lines.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
        <span className="mt-2 block">You can undo it afterwards.</span>
      </Confirm>
    </>
  );
}

function dismissAction(plan: PlanDetail, edits: ReturnType<typeof usePlanEdits>): HeaderAction | null {
  const rule = plan.source === "rule";
  if (plan.status === "dismissed" || (rule && plan.counts.open === 0)) return null;
  return {
    label: rule ? `Dismiss all ${fmtInt(plan.counts.open)}` : "Dismiss plan",
    onClick: () =>
      void edits.dismiss("all").then((dismissed) => {
        if (dismissed) showToast(rule ? `Dismissed ${songs(plan.counts.open)}` : "Plan dismissed", "info", { label: "Undo", onClick: () => void edits.restore("all") });
      }),
  };
}

function PlanSkeleton() {
  return (
    <Page crumb={undefined}>
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <RowSkeleton rows={8} />
    </Page>
  );
}

/** One plan: what it would change, grouped by action and place, with ticks, archive or remove, Apply and Undo. */
export function PlanPage({ id }: { id: number }) {
  const [status, setStatus] = useState<ItemStatus>("open");
  const q = usePlan(id, "open");
  const batches = useBatches();
  const spotify = useStatus().data?.spotify;
  const { undo, pending } = useUndo();
  const edits = usePlanEdits(id);
  const chat = useChat();
  const ai = useAi();
  useBatchEndings(batches.data?.items, (b) => void undo(b));
  const plan = q.data?.pages[0];
  useDocumentTitle(plan?.title ?? "Plan");

  if (q.isError)
    return (
      <Page crumb={null}>
        <PageHeader title="Plan" />
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState
            size="page"
            icon={BroomIcon}
            title="This plan does not exist"
            action={
              <AppLink to="/library/plans" className={buttonClass()}>
                Back to plans
              </AppLink>
            }
          />
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </Page>
    );
  if (!plan) return <PlanSkeleton />;

  const latest = batches.data?.items.find((b) => b.planId === id);
  const tabs = (["open", "applied", "skipped", "dismissed"] as const).filter((s) => s === "open" || plan.counts[s] > 0);
  const thread = plan.threadId;
  const secondary = [
    thread && ai.configured
      ? {
          label: chat.runningFor({ kind: "plan", threadId: thread }) ? "Changing…" : "Change",
          icon: ChatCircleTextIcon,
          onClick: () => chat.show({ thread: { kind: "plan", threadId: thread } }),
        }
      : null,
    dismissAction(plan, edits),
  ].filter((a): a is HeaderAction => a !== null);
  const main = (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title={plan.title}
        description={plan.summary || (plan.source === "rule" ? undefined : SOURCE_LABEL[plan.source])}
        actions={<ApplyButton plan={plan} latest={latest} connected={spotify?.connected !== false} />}
        secondary={secondary}
      />
      {plan.status === "dismissed" && (
        <Notice
          action={
            <Button size="sm" onClick={() => void edits.restore("all")}>
              Restore
            </Button>
          }
        >
          This plan is dismissed.
        </Notice>
      )}
      {spotify && !spotify.connected && plan.status === "open" && (
        <Notice
          tone="warning"
          action={
            <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
              Connect Spotify
            </AppLink>
          }
        >
          Spotify is not connected, so this plan cannot be applied.
        </Notice>
      )}
      {latest && <BatchStatus batch={latest} onUndo={() => void undo(latest.id)} undoing={pending === latest.id} />}
      <Section>
        {tabs.length > 1 && (
          <TabsRoot value={status} onValueChange={(v) => setStatus(v as ItemStatus)}>
            <div className="hairline-b">
              <TabList
                label="Songs in this plan"
                options={tabs.map((s) => ({
                  value: s,
                  label: (
                    <>
                      {STATUS_LABEL[s]}
                      <span className="text-tertiary tabular">{fmtInt(plan.counts[s])}</span>
                    </>
                  ),
                }))}
              />
            </div>
          </TabsRoot>
        )}
        <Items id={id} status={status} plan={plan} />
      </Section>
    </div>
  );

  return <Page crumb={plan.title}>{main}</Page>;
}
