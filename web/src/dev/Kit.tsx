import { useState, type ReactNode } from "react";
import { DitherMeter } from "../charts/DitherMeter";
import { HeatLegend } from "../charts/DitherHeatmap";
import { RateMeter } from "../charts/RateMeter";
import { showToast } from "../lib/toast";
import type { RunState } from "../lib/useRun";
import { EncoreMark, Lockup } from "../ui/Brand";
import { Button, IconButton } from "../ui/Button";
import { Composer } from "../ui/Composer";
import { Confirm, Dialog, DialogClose } from "../ui/Dialog";
import { Field, Input } from "../ui/Field";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { DotsThreeIcon, MagnifyingGlassIcon, PlayIcon, PlusIcon, ShuffleIcon, SparkleIcon, XIcon } from "../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { Page, PageHeader, Section } from "../ui/Page";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "../ui/Popover";
import { RunProgress } from "../ui/RunProgress";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState } from "../ui/States";
import { Switch } from "../ui/Switch";
import { Tooltip } from "../ui/Tooltip";

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded-sm shadow-control" style={{ background: `var(--${name})` }} />
      <span className="text-caption text-secondary">{name}</span>
    </div>
  );
}

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
export function Kit() {
  const [seg, setSeg] = useState<"a" | "b" | "c">("a");
  const [sel, setSel] = useState("week");
  const [on, setOn] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState("");
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
          <p className="font-serif text-display">Display 44</p>
          <p className="font-serif text-title">Title 34</p>
          <p className="font-serif text-figure tabular">1,284 figure</p>
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
              <HeatLegend />
            </div>
          </StatStrip>
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
        </Section>
      </div>
    </Page>
  );
}
