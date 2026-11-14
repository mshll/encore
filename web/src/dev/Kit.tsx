import { useState, type ReactNode } from "react";
import { BudgetBar } from "../charts/BudgetBar";
import { DitherMeter } from "../charts/DitherMeter";
import { HeatLegend } from "../charts/DitherHeatmap";
import { RateMeter } from "../charts/RateMeter";
import { showToast } from "../lib/toast";
import type { RunState } from "../lib/useRun";
import { Artwork, type ArtBox, type ArtKind } from "../ui/Artwork";
import { EncoreMark, Lockup } from "../ui/Brand";
import { Button, IconButton } from "../ui/Button";

import { Checkbox } from "../ui/Checkbox";
import { Combobox } from "../ui/Combobox";
import { Composer } from "../ui/Composer";
import { Conversation } from "../ui/Conversation";
import { CopyField } from "../ui/CopyField";
import { Confirm, Dialog, DialogClose } from "../ui/Dialog";
import { EntityHeader, EntityHeaderSkeleton } from "../ui/EntityHeader";
import { DropZone } from "../ui/DropZone";
import { Field, Input } from "../ui/Field";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { DotsThreeIcon, MagnifyingGlassIcon, PlayIcon, PlusIcon, ShuffleIcon, SparkleIcon, XIcon } from "../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { Page, PageHeader, Section } from "../ui/Page";
import { Notice } from "../ui/Notice";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "../ui/Popover";
import { RunProgress } from "../ui/RunProgress";
import { SearchField } from "../ui/SearchField";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState } from "../ui/States";
import { Switch } from "../ui/Switch";
import { Tooltip } from "../ui/Tooltip";
import { WeekdayPicker } from "../ui/WeekdayPicker";

const ZONES = [
  { value: "Asia/Kuwait", label: "Kuwait", detail: "UTC+3" },
  { value: "Europe/London", label: "London", detail: "UTC+0" },
  { value: "America/Argentina/ComodRivadavia", label: "Argentina, ComodRivadavia", detail: "UTC−3" },
];

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded-sm shadow-control" style={{ background: `var(--${name})` }} />
      <span className="text-caption text-secondary">{name}</span>
    </div>
  );
}

/** An image that fails to decode: the broken state. */
const BROKEN_ART = "data:image/png;base64,AAAA";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center">
      <span className="text-secondary">{label}</span>
      <div className="flex min-w-0 flex-col items-start gap-2 md:flex-row md:items-center">{children}</div>
    </div>
  );
}

const SURFACES = ["surface-shell", "surface-page", "surface-card", "surface-sunken", "surface-overlay", "surface-standout"];
const FILLS = ["fill", "fill-hover", "fill-active", "fill-inverted", "accent", "accent-subtle", "danger", "warning"];
const RUN: RunState = {
  running: true,
  steps: ["Reading your last 90 days", "Searching your history for late-night songs", "Checking 12 new songs on Spotify"],
  text: "",
  searches: 3,
  checked: 12,
  startedAt: Date.now() - 42_000,
  problem: null,
};

/** Every primitive in its states, for the gate. Dev builds only. */
/** A thread in a fixed box: empty with starters, then pinned once a message is sent. Clear goes back. */
function ConversationDemo() {
  const [draft, setDraft] = useState("");
  const [said, setSaid] = useState<string[]>([]);
  const send = (text: string) => {
    setSaid((s) => [...s, text]);
    setDraft("");
  };
  return (
    <div className="flex h-96 flex-col gap-3">
      <Conversation
        contained
        follow={said.length}
        messages={
          said.length > 0 && (
            <ol className="flex flex-col gap-4">
              {said.map((m, i) => (
                <li key={i} className="flex flex-col gap-2">
                  <p className="max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-pretty">{m}</p>
                  <p className="text-pretty">Mostly Frank Ocean and Mac Miller, late at night, with fewer skips than any other hour.</p>
                </li>
              ))}
            </ol>
          )
        }
        composer={<Composer value={draft} onChange={setDraft} onSubmit={() => send(draft.trim())} label="Ask about your listening" placeholder="What did I play most last winter?" />}
        empty={
          <ul className="mt-4 flex flex-col">
            {["What do I play on Fridays?", "Which songs do I skip only on weekends?"].map((q) => (
              <li key={q}>
                <button type="button" className="-mx-2 flex min-h-(--control-h) w-full items-center rounded-md px-2 text-left hover:bg-fill" onClick={() => send(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        }
      />
      {said.length > 0 && (
        <Button size="sm" className="self-start" onClick={() => setSaid([])}>
          Clear
        </Button>
      )}
    </div>
  );
}

export function Kit() {
  const [seg, setSeg] = useState<"a" | "b" | "c">("a");
  const [sel, setSel] = useState("week");
  const [on, setOn] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState<string | null>("Asia/Kuwait");
  const [days, setDays] = useState<number[]>([5, 6]);
  const [ticks, setTicks] = useState<Set<number>>(new Set([1]));
  const tick = (n: number) => setTicks((t) => { const next = new Set(t); if (!next.delete(n)) next.add(n); return next; });
  const [metric, setMetric] = useState<"hours" | "plays">("hours");
  const figures: StatItem<"hours" | "plays">[] = [
    { id: "hours", label: "Time listened", value: "1,284", unit: "hours", delta: 0.12, compare: "from 1,146" },
    { id: "plays", label: "Plays", value: "38.2K", delta: -0.04, compare: "from 39.8K" },
  ];
  return (
    <Page>
      <PageHeader title="Kit" description="Primitives in their states." />
      <div className="flex flex-col gap-12">
        <Section title="Brand">
          <Row label="Mark">
            <EncoreMark size={16} />
            <EncoreMark size={32} />
            <EncoreMark size={48} />
          </Row>
          <Row label="Lockup">
            <Lockup />
            <Lockup size={32} />
          </Row>
        </Section>
        <Section title="Colour">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[...SURFACES, ...FILLS].map((n) => (
              <Swatch key={n} name={n} />
            ))}
          </div>
        </Section>
        <Section title="Type">
          <p className="font-display text-display">Display 40</p>
          <p className="font-display text-title">Title 30</p>
          <p className="font-display text-figure tabular">1,284 figure</p>
          <p className="text-heading font-medium">Heading 15</p>
          <p className="text-body">Body 14 for reading text.</p>
          <p>Body small 13, the default.</p>
          <p className="text-caption text-secondary">Caption 12</p>
          <p className="text-label text-tertiary">Label 11</p>
        </Section>
        <Section title="Buttons">
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="accent" icon={PlayIcon}>
              Play
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Remove</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
          </Row>
          <Row label="States">
            <Button disabled>Disabled</Button>
            <Button busy busyLabel="Saving">
              Save
            </Button>
          </Row>
          <Row label="Icon buttons">
            <IconButton icon={ShuffleIcon} label="Shuffle" />
            <IconButton icon={PlayIcon} label="Play" variant="primary" fill />
            <IconButton icon={XIcon} label="Close" size="sm" />
            <Tooltip label="More">
              <IconButton icon={DotsThreeIcon} label="More" />
            </Tooltip>
          </Row>
          <Row label="Key caps">
            <Kbd>{MOD_KEY}</Kbd>
            <Kbd>K</Kbd>
          </Row>
        </Section>
        <Section title="Fields">
          <Row label="Input">
            <Input icon={MagnifyingGlassIcon} aria-label="Search" placeholder="Search" className="w-64" />
            <Input invalid aria-label="Invalid example" defaultValue="Wrong" className="w-40" />
          </Row>
          <Row label="SearchField">
            <SearchField label="Search artists" placeholder="Artist name…" value={search} onChange={setSearch} />
          </Row>
          <Field label="Monthly cap" hint="In US dollars." error={undefined}>
            {(p) => <Input {...p} defaultValue="20" className="w-40" />}
          </Field>
          <Field label="Setup token" error="That token is not the one on the server.">
            {(p) => <Input {...p} defaultValue="abc" className="w-64" />}
          </Field>
          <Row label="Select">
            <Select label="Period" value={sel} onChange={setSel} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
          </Row>
          <Row label="Switch">
            <Switch checked={on} onChange={setOn} label="Weekly picks" />
            <Switch checked={false} onChange={() => {}} label="Disabled" disabled />
          </Row>
          <Row label="Segmented">
            <Segmented label="View" value={seg} onChange={setSeg} options={[{ value: "a", label: "Hours" }, { value: "b", label: "Plays" }, { value: "c", label: "Listens" }]} />
          </Row>
        </Section>
        <Section title="Settings">
          <SettingRows>
            <SettingRow label="Timezone" hint="Plays already stored keep the day they were counted in.">
              {(p) => <Combobox {...p} value={zone} onChange={setZone} options={ZONES} />}
            </SettingRow>
            <SettingRow label="Weekend days">{(p) => <WeekdayPicker {...p} label="Weekend days" value={days} onChange={setDays} />}</SettingRow>
            <SettingRow label="Home country" error="Use a two-letter country code, such as KW.">
              {(p) => <Input {...p} defaultValue="kuwait" />}
            </SettingRow>
            <SettingRow label="Redirect URI" wide>
              {() => <CopyField value="https://encore.example.com/api/spotify/callback" label="Copy redirect URI" />}
            </SettingRow>
          </SettingRows>
          <Row label="Checkbox">
            <Checkbox checked={ticks.size === 2} indeterminate={ticks.size === 1} onChange={() => setTicks(ticks.size === 2 ? new Set() : new Set([1, 2]))} label="Select all" />
            <Checkbox checked={ticks.has(1)} onChange={() => tick(1)} label="First" />
            <Checkbox checked={ticks.has(2)} onChange={() => tick(2)} label="Second" />
          </Row>
          <Notice>Secrets cannot be saved until SECRETS_KEY is set on the server.</Notice>
          <Notice tone="warning" action={<Button size="sm">Connect again</Button>}>
            Spotify paused logging after repeated errors.
          </Notice>
          <Notice tone="danger">That file is not a Spotify streaming history export. Nothing was imported.</Notice>
          <DropZone onFiles={(f) => showToast(`${f.length} files picked`)} title="Drop your Streaming_History_Audio files here" description="Unzip the export first." />
        </Section>
        <Section title="Overlays">
          <Row label="Menu">
            <MenuRoot>
              <MenuTrigger render={<Button iconEnd={DotsThreeIcon}>Song</Button>} />
              <MenuPopup>
                <MenuItem icon={PlayIcon}>Play</MenuItem>
                <MenuItem icon={PlusIcon}>Add to queue</MenuItem>
                <MenuSeparator />
                <MenuItem danger>Remove</MenuItem>
              </MenuPopup>
            </MenuRoot>
            <PopoverRoot>
              <PopoverTrigger render={<Button>Popover</Button>} />
              <PopoverPopup className="w-64 p-3">A popover holds a small form or a few facts.</PopoverPopup>
            </PopoverRoot>
          </Row>
          <Row label="Dialogs">
            <Button onClick={() => setDialog(true)}>Dialog</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Confirm
            </Button>
            <Dialog
              open={dialog}
              onOpenChange={setDialog}
              title="Rename set"
              footer={
                <>
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button variant="primary" onClick={() => setDialog(false)}>
                    Save
                  </Button>
                </>
              }
            >
              <Field label="Name">{(p) => <Input {...p} defaultValue="Late drive" />}</Field>
            </Dialog>
            <Confirm open={confirm} onOpenChange={setConfirm} title="Delete this set?" action="Delete" danger onConfirm={() => setConfirm(false)}>
              The set and its notes are deleted. The Spotify playlist stays.
            </Confirm>
          </Row>
          <Row label="Toasts">
            <Button onClick={() => showToast("Added to queue")}>Info</Button>
            <Button onClick={() => showToast("Removed 12 songs", "info", { label: "Undo", onClick: () => showToast("Restored 12 songs") })}>With undo</Button>
            <Button onClick={() => showToast("Spotify did not answer", "problem")}>Problem</Button>
          </Row>
        </Section>
        <Section title="Figures and charts">
          <StatStrip items={figures} value={metric} onChange={setMetric} label="Figures">
            <div className="flex flex-col gap-2 pt-4">
              <DitherMeter share={metric === "hours" ? 0.8 : 0.35} />
              <BudgetBar spent={7.42} cap={20} label="Claude spend this month" />
              <BudgetBar spent={21.1} cap={20} label="Claude spend, over the cap" />
              <HeatLegend />
            </div>
          </StatStrip>
        </Section>
        <Section title="Artwork">
          {(["artist", "album", "song", "playlist"] as ArtKind[]).map((kind) => (
            <Row key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)}`}>
              <div className="flex flex-wrap items-end gap-4">
                {([24, 32, 40, 48, 56, 64] as ArtBox[]).map((box) => (
                  <Artwork key={box} src={null} kind={kind} box={box} />
                ))}
                <div className="w-40">
                  <Artwork src={null} kind={kind} box="fill" />
                </div>
                <Artwork src={BROKEN_ART} kind={kind} box={48} />
              </div>
            </Row>
          ))}
        </Section>
        <Section title="Entity header">
          <EntityHeader
            title="Glimpse of Us"
            art={null}
            kind="song"
            credits="Joji · SMITHEREENS"
            detail="First played 29 Dec 2024, last played 2 months ago"
            actions={
              <Button variant="accent" icon={PlayIcon}>
                Play
              </Button>
            }
            aside={<Button>All time</Button>}
          />
          <EntityHeaderSkeleton round />
        </Section>
        <Section title="Rate meter">
          <Row label="Rate with mark">
            <RateMeter rate={0.6} mark={0.5} className="w-40" />
          </Row>
          <Row label="Zero and full">
            <RateMeter rate={0} mark={0.5} className="w-40" />
            <RateMeter rate={1} className="w-40" />
          </Row>
        </Section>
        <Section title="States">
          <Skeleton className="h-10 w-full" />
          <EmptyState size="section" icon={SparkleIcon} title="No picks yet" description="Picks arrive on Monday morning." action={<Button>Make picks now</Button>} />
          <ErrorState size="section" error={new TypeError("Failed to fetch")} onRetry={() => {}} />
        </Section>
        <Section title="Runs">
          <RunProgress run={RUN} title="Making picks" onCancel={() => {}} />
          <Composer value={text} onChange={setText} onSubmit={() => setText("")} label="Ask about your listening" placeholder="What did I play most last winter?" />
          <Notice tone="warning">Spotify calls are paused until 14:30, so songs new to you cannot be checked.</Notice>
          <Notice tone="danger" onRetry={() => {}}>
            The Anthropic API did not answer. Try again in a minute.
          </Notice>
          <Composer value="" onChange={() => {}} onSubmit={() => {}} label="Describe a set" disabled notice="Claude is not set up." />
        </Section>
        <Section title="Conversation">
          <ConversationDemo />
        </Section>
      </div>
    </Page>
  );
}
