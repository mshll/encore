import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../../api/client";
import { useLivingPlaylist } from "../../api/queries";
import type { LivingDetail, LivingId, LivingQuietUpdate, LivingUpdate, RuleInput, RulePreview } from "../../api/types";
import { fmtHour, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { Input } from "../../ui/Field";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile, useDocumentTitle } from "../../ui/Page";
import { RowList, RowSkeleton } from "../../ui/Rows";
import { Select } from "../../ui/Select";
import { SettingRow, SettingRows } from "../../ui/SettingRow";
import { EmptyState, ErrorState } from "../../ui/States";
import { Switch } from "../../ui/Switch";
import { WeekdayPicker } from "../../ui/WeekdayPicker";
import { PlaylistMissing } from "./LivingPage";
import { fromRule, NEW_RULE, toRule, type RuleForm, type RuleFormErrors } from "./rules";
import { isLivingId, playlistPath, SongRow, songs } from "./shared";

const HOURS = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: fmtHour(h % 24) }));

type SetField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => void;

function NumberInput({ value, onChange, placeholder, ...p }: { value: string; onChange: (v: string) => void; placeholder?: string; id: string; "aria-describedby"?: string; invalid: boolean }) {
  return <Input {...p} type="number" inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-32" />;
}

/** Two numbers side by side: "3 to 40". */
function Between({ from, to, id }: { from: ReactNode; to: ReactNode; id: string }) {
  return (
    <div id={id} className="flex items-center gap-2">
      {from}
      <span className="text-secondary">to</span>
      {to}
    </div>
  );
}

function SourceFields({ form, set, errors }: { form: RuleForm; set: SetField; errors: RuleFormErrors }) {
  return (
    <SettingRows>
      <SettingRow label="Songs from">
        {() => (
          <Select
            label="Songs from"
            value={form.source}
            onChange={(v) => set("source", v)}
            options={[
              { value: "history", label: "What you played" },
              { value: "moment", label: "A time of the week" },
              { value: "liked", label: "Your liked songs" },
              { value: "releases", label: "New releases" },
              { value: "picks", label: "This week’s picks" },
            ]}
          />
        )}
      </SettingRow>
      {form.source === "history" && (
        <SettingRow label="Played in" error={errors.windowDays ?? errors.rangeFrom ?? errors.rangeTo}>
          {(p) => (
            <div className="flex flex-col gap-2">
              <Select
                label="Played in"
                value={form.window}
                onChange={(v) => set("window", v)}
                options={[
                  { value: "days", label: "The last few days" },
                  { value: "all", label: "All time" },
                  { value: "year-to-date", label: "This year" },
                  { value: "month-in-past-years", label: "This month in earlier years" },
                  { value: "range", label: "Between two days" },
                ]}
              />
              {form.window === "days" && (
                <div className="flex items-center gap-2">
                  <NumberInput {...p} value={form.windowDays} onChange={(v) => set("windowDays", v)} />
                  <span className="text-secondary">days</span>
                </div>
              )}
              {form.window === "range" && (
                <Between
                  id={p.id}
                  from={<Input type="date" aria-label="From" value={form.rangeFrom} onChange={(e) => set("rangeFrom", e.target.value)} invalid={Boolean(errors.rangeFrom)} />}
                  to={<Input type="date" aria-label="To, empty for today" value={form.rangeTo} onChange={(e) => set("rangeTo", e.target.value)} invalid={Boolean(errors.rangeTo)} />}
                />
              )}
            </div>
          )}
        </SettingRow>
      )}
      {form.source === "moment" && (
        <>
          <SettingRow label="On" error={errors.weekdays}>
            {(p) => <WeekdayPicker {...p} label="On" value={form.weekdays} onChange={(d) => set("weekdays", d)} />}
          </SettingRow>
          <SettingRow label="Between" error={errors.hourTo ?? errors.hourFrom}>
            {(p) => (
              <Between
                id={p.id}
                from={<Select label="From" value={form.hourFrom} onChange={(v) => set("hourFrom", v)} options={HOURS.slice(0, 24)} />}
                to={<Select label="To" value={form.hourTo} onChange={(v) => set("hourTo", v)} options={HOURS.slice(1)} />}
              />
            )}
          </SettingRow>
        </>
      )}
      {form.source === "releases" && (
        <SettingRow label="Released in the last" error={errors.releaseDays}>
          {(p) => (
            <div className="flex items-center gap-2">
              <NumberInput {...p} value={form.releaseDays} onChange={(v) => set("releaseDays", v)} />
              <span className="text-secondary">days</span>
            </div>
          )}
        </SettingRow>
      )}
    </SettingRows>
  );
}

function FilterFields({ form, set, errors }: { form: RuleForm; set: SetField; errors: RuleFormErrors }) {
  return (
    <SettingRows>
      <SettingRow label="Listens" error={errors.listensMin ?? errors.listensMax}>
        {(p) => (
          <Between
            id={p.id}
            from={<NumberInput id={`${p.id}-min`} invalid={Boolean(errors.listensMin)} value={form.listensMin} onChange={(v) => set("listensMin", v)} placeholder="Any" />}
            to={<NumberInput id={`${p.id}-max`} invalid={Boolean(errors.listensMax)} value={form.listensMax} onChange={(v) => set("listensMax", v)} placeholder="Any" />}
          />
        )}
      </SettingRow>
      <SettingRow label="Last played" error={errors.lastPlayedDays}>
        {(p) => (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Last played"
              value={form.lastPlayed}
              onChange={(v) => set("lastPlayed", v)}
              options={[
                { value: "any", label: "Any time" },
                { value: "not-within", label: "Not in the last" },
                { value: "within", label: "In the last" },
              ]}
            />
            {form.lastPlayed !== "any" && (
              <>
                <NumberInput {...p} value={form.lastPlayedDays} onChange={(v) => set("lastPlayedDays", v)} />
                <span className="text-secondary">days</span>
              </>
            )}
          </div>
        )}
      </SettingRow>
      <SettingRow label="First played" error={errors.firstPlayedDays}>
        {(p) => (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="First played"
              value={form.firstPlayed}
              onChange={(v) => set("firstPlayed", v)}
              options={[
                { value: "any", label: "Any time" },
                { value: "before", label: "More than" },
                { value: "within", label: "In the last" },
              ]}
            />
            {form.firstPlayed !== "any" && (
              <>
                <NumberInput {...p} value={form.firstPlayedDays} onChange={(v) => set("firstPlayedDays", v)} />
                <span className="text-secondary">{form.firstPlayed === "before" ? "days ago" : "days"}</span>
              </>
            )}
          </div>
        )}
      </SettingRow>
      <SettingRow label="Only these artists" hint="Separate names with commas" error={errors.include}>
        {(p) => <Input {...p} value={form.include} onChange={(e) => set("include", e.target.value)} placeholder="Any artist" autoCapitalize="none" autoCorrect="off" />}
      </SettingRow>
      <SettingRow label="Leave out artists" error={errors.exclude}>
        {(p) => <Input {...p} value={form.exclude} onChange={(e) => set("exclude", e.target.value)} placeholder="None" autoCapitalize="none" autoCorrect="off" />}
      </SettingRow>
      <SettingRow label="Released" error={errors.yearMin ?? errors.yearMax}>
        {(p) => (
          <Between
            id={p.id}
            from={<NumberInput id={`${p.id}-from`} invalid={Boolean(errors.yearMin)} value={form.yearMin} onChange={(v) => set("yearMin", v)} placeholder="Any year" />}
            to={<NumberInput id={`${p.id}-to`} invalid={Boolean(errors.yearMax)} value={form.yearMax} onChange={(v) => set("yearMax", v)} placeholder="Any year" />}
          />
        )}
      </SettingRow>
      <SettingRow label="Played through at least" error={errors.keepers}>
        {(p) => (
          <div className="flex items-center gap-2">
            <NumberInput {...p} value={form.keepers} onChange={(v) => set("keepers", v)} placeholder="Any" />
            <span className="text-secondary">% of plays</span>
          </div>
        )}
      </SettingRow>
    </SettingRows>
  );
}

function ShapeFields({ form, set, errors }: { form: RuleForm; set: SetField; errors: RuleFormErrors }) {
  return (
    <SettingRows>
      <SettingRow label="Order">
        {() => (
          <Select
            label="Order"
            value={form.sort}
            onChange={(v) => set("sort", v)}
            options={[
              { value: "source", label: form.source === "liked" || form.source === "releases" ? "Newest first" : form.source === "picks" ? "In pick order" : "Most played first" },
              { value: "listens", label: "Most played first" },
              { value: "recent", label: "Last played first" },
              { value: "first-played", label: "Earliest found first" },
              { value: "keepers", label: "Most played through first" },
              { value: "shuffle", label: "Shuffled at each refresh" },
            ]}
          />
        )}
      </SettingRow>
      <SettingRow label="At most" error={errors.limit}>
        {(p) => (
          <div className="flex items-center gap-2">
            <NumberInput {...p} value={form.limit} onChange={(v) => set("limit", v)} />
            <span className="text-secondary">songs</span>
          </div>
        )}
      </SettingRow>
      <SettingRow label="Songs per artist" error={errors.perArtist}>
        {(p) => <NumberInput {...p} value={form.perArtist} onChange={(v) => set("perArtist", v)} placeholder="No limit" />}
      </SettingRow>
      <SettingRow label="Keep earlier songs" hint={form.rolling ? undefined : "Off: each refresh rebuilds the list"} error={errors.perRefresh}>
        {(p) => (
          <div className="flex flex-wrap items-center gap-3">
            <Switch id={p.id} checked={form.rolling} onChange={(on) => set("rolling", on)} label="Keep earlier songs" />
            {form.rolling && (
              <span className="flex items-center gap-2">
                <span className="text-secondary">add</span>
                <NumberInput id={`${p.id}-n`} invalid={Boolean(errors.perRefresh)} value={form.perRefresh} onChange={(v) => set("perRefresh", v)} />
                <span className="text-secondary">at a time</span>
              </span>
            )}
          </div>
        )}
      </SettingRow>
      <SettingRow label="Refresh">
        {() => (
          <Select
            label="Refresh"
            value={form.schedule}
            onChange={(v) => set("schedule", v)}
            options={[
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Every Monday" },
              { value: "monthly", label: "On the 1st of each month" },
            ]}
          />
        )}
      </SettingRow>
    </SettingRows>
  );
}

/** What the rule would hold now, read again a moment after each change. */
function usePreview(input: RuleInput | null) {
  const key = input ? JSON.stringify(input.rule) : null;
  const [state, setState] = useState<{ key: string; data?: RulePreview; error?: unknown } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const timer = setTimeout(() => {
      request<RulePreview>("/api/living/preview", { json: { rule: JSON.parse(key) as unknown } })
        .then((data) => live && setState({ key, data }))
        .catch((error: unknown) => live && setState({ key, error }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return { stale: state?.key !== key, data: state?.data, error: state?.error, retry: () => setState(null) };
}

const PREVIEW_FIRST = 20;

type PreviewState = ReturnType<typeof usePreview>;

/** The preview's song count beside Create while the preview sits below the whole form (one column). */
function PreviewCount({ preview, input }: { preview: PreviewState; input: RuleInput | null }) {
  const d = preview.data;
  const known = input && d && !preview.stale;
  return (
    <span aria-live="polite" className="text-secondary tabular @min-[700px]/page:hidden">
      {known ? (d.count === 0 ? "No song meets the rule" : songs(d.count)) : null}
    </span>
  );
}

function Preview({ input, id, preview }: { input: RuleInput | null; id: LivingId | null; preview: PreviewState }) {
  const d = preview.data;
  const [all, setAll] = useState(false);
  return (
    <Section title="It would hold" description={d && !preview.stale ? songs(d.count) : undefined} className="@min-[700px]/page:sticky lg:top-6 lg:self-start">
      {!input ? (
        <p className="text-secondary">Fix the fields marked above to see the songs.</p>
      ) : preview.error && !preview.stale ? (
        <ErrorState size="inline" error={preview.error} onRetry={preview.retry} />
      ) : !d ? (
        <RowSkeleton rows={6} />
      ) : d.count === 0 ? (
        <EmptyState size="inline" title="No song meets the rule" description="Widen the time, or loosen a filter." />
      ) : (
        <div className="flex flex-col gap-2">
          <RowList label="Preview" className={dimWhile(preview.stale)}>
            {(all ? d.songs : d.songs.slice(0, PREVIEW_FIRST)).map((s, i) => (
              <SongRow key={s.uri} song={s} rank={i + 1} kind={id ?? "rule-preview"} />
            ))}
          </RowList>
          {d.songs.length > PREVIEW_FIRST && (
            <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${fmtInt(d.songs.length)}`}
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function Builder({ playlist }: { playlist: LivingDetail | null }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [form, setForm] = useState<RuleForm>(() => (playlist ? fromRule(playlist.name, playlist.about, playlist.rule) : NEW_RULE));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const set: SetField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const { input, errors } = toRule(form);
  const shown: RuleFormErrors = tried ? errors : { ...errors, name: undefined };
  const ruleInput = input ?? (Object.keys(errors).length === 1 && errors.name ? toRule({ ...form, name: "Preview" }).input : null);
  const preview = usePreview(ruleInput);
  const title = playlist ? `Edit ${playlist.name}` : "New playlist";
  useDocumentTitle(title);

  const submit = async () => {
    setTried(true);
    if (!input) return;
    setBusy(true);
    try {
      if (playlist) {
        const update = await request<LivingUpdate | LivingQuietUpdate>(`/api/living/${playlist.kind}`, { method: "PUT", json: input });
        queryClient.setQueryData(["living", playlist.kind], update.playlist);
        await queryClient.invalidateQueries({ queryKey: ["living"], exact: true });
        navigate(playlistPath(playlist.kind));
        showToast(update.outcome ? `${input.name} is saved and updated in Spotify.` : `${input.name} is saved.`);
      } else {
        const made = await request<{ playlist: LivingDetail }>("/api/living", { json: input });
        queryClient.setQueryData(["living", made.playlist.kind], made.playlist);
        await queryClient.invalidateQueries({ queryKey: ["living"], exact: true });
        navigate(playlistPath(made.playlist.kind));
      }
    } catch (error) {
      showToast(error instanceof ApiError && error.status === 400 ? "encore could not read this rule. Check the fields and try again." : "Could not save it. Try again.", "problem");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page crumb={playlist ? `Edit ${playlist.name}` : "New playlist"}>
      <PageHeader title={title} />
      <form
        className={SIDE_COLUMNS}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex min-w-0 flex-col gap-10">
          <SettingRows>
            <SettingRow label="Name" error={shown.name}>
              {(p) => <Input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Old Mac Miller" maxLength={100} />}
            </SettingRow>
            <SettingRow label="Description" error={shown.about}>
              {(p) => <Input {...p} value={form.about} onChange={(e) => set("about", e.target.value)} placeholder="Shown in Spotify" maxLength={300} />}
            </SettingRow>
          </SettingRows>
          <Section title="Where the songs come from">
            <SourceFields form={form} set={set} errors={shown} />
          </Section>
          <Section title="Only songs that">
            <FilterFields form={form} set={set} errors={shown} />
          </Section>
          <Section title="Order and size">
            <ShapeFields form={form} set={set} errors={shown} />
          </Section>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" busy={busy} busyLabel="Saving">
              {playlist ? "Save" : "Create"}
            </Button>
            <AppLink to={playlist ? playlistPath(playlist.kind) : "/playlists"} className={buttonClass({ variant: "ghost" })}>
              Cancel
            </AppLink>
            <PreviewCount preview={preview} input={ruleInput} />
          </div>
        </div>
        <Preview input={ruleInput} id={playlist?.kind ?? null} preview={preview} />
      </form>
    </Page>
  );
}

function EditBuilder({ id }: { id: LivingId }) {
  const q = useLivingPlaylist(id);
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <PlaylistMissing /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <Page crumb={undefined}>
        <RowSkeleton rows={8} />
      </Page>
    );
  if (q.data.builtin) return <PlaylistMissing />;
  return <Builder playlist={q.data} />;
}

/** Build from rules: the rule in plain fields with a live preview, then Create. The same form edits a rule playlist. */
export function RuleBuilder({ id }: { id?: string }) {
  if (id === undefined) return <Builder playlist={null} />;
  return isLivingId(id) ? <EditBuilder id={id} /> : <PlaylistMissing />;
}
