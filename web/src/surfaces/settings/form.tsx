import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ApiError, request } from "../../api/client";
import { useSettings } from "../../api/queries";
import type { SettingField, SettingIssue, Settings, SettingsEffect, SettingsPatchResult, SettingValue } from "../../api/types";
import { countryName, fmtDay, fmtHour, fmtInt, WEEKDAYS } from "../../lib/format";
import { settingHint, settingLabel, UNIT_LABELS } from "../../lib/settingLabels";
import { showToast } from "../../lib/toast";
import { Button } from "../../ui/Button";
import { Combobox, type ComboboxOption } from "../../ui/Combobox";
import { Input } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { Select } from "../../ui/Select";
import { SettingRow, SettingRows, type SettingControlProps } from "../../ui/SettingRow";
import { describeError } from "../../ui/States";
import { Switch } from "../../ui/Switch";
import { WeekdayPicker } from "../../ui/WeekdayPicker";

/** A pending edit. Numbers stay as typed text until save; `null` clears a stored value (the default applies again). */
type Draft = Record<string, SettingValue | null>;

const ENUM_LABELS: Record<string, string> = { deterministic: "Rules", llm: "AI", anthropic: "Anthropic", openai: "OpenAI", google: "Google Gemini", "openai-compatible": "OpenAI-compatible" };

export function fieldsByKey(settings: Settings | undefined): Map<string, SettingField> {
  return new Map((settings?.groups ?? []).flatMap((g) => g.fields.map((f) => [f.key, f] as const)));
}

const offsetFmt = new Map<string, Intl.DateTimeFormat>();
function utcOffset(zone: string): string {
  try {
    let fmt = offsetFmt.get(zone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" });
      offsetFmt.set(zone, fmt);
    }
    const name = fmt.formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    return name.replace("GMT", "UTC") || "UTC";
  } catch (error) {
    if (error instanceof RangeError) return "";
    throw error;
  }
}

export const zoneLabel = (zone: string) => zone.replaceAll("_", " ").replaceAll("/", " / ");

export function useZoneOptions(field: SettingField | undefined): ComboboxOption[] {
  const zones = field?.options;
  return useMemo(() => (zones ?? []).map((z) => ({ value: z, label: zoneLabel(z), detail: utcOffset(z) })), [zones]);
}

/** A value as words, for locked fields and summaries. */
export function displayValue(field: SettingField): string {
  const v = field.value;
  if (field.secret) return field.set ? (field.hint ? `Set, ends in ${field.hint}` : "Set") : "Not set";
  if (v === null || v === "") return "Not set";
  if (field.type === "boolean") return v ? "On" : "Off";
  if (field.type === "weekdays" && Array.isArray(v)) return v.map((d) => WEEKDAYS[d - 1]).join(", ");
  if (field.type === "timezone") return zoneLabel(String(v));
  if (field.type === "date") return fmtDay(String(v));
  if (field.unit === "weekday") return WEEKDAYS[Number(v) - 1] ?? String(v);
  if (field.unit === "hour") return fmtHour(Number(v));
  if (field.unit === "usd") return `$${fmtInt(Number(v))}`;
  if (field.unit === "usdPerMTok") return `$${Number(v)} per 1M tokens`;
  if (field.key === "homeCountry") return `${countryName(String(v))} (${String(v)})`;
  if (field.type === "enum") return ENUM_LABELS[String(v)] ?? String(v);
  if (typeof v === "number" && field.unit) return `${fmtInt(v)} ${UNIT_LABELS[field.unit] ?? field.unit}`;
  return String(v);
}

function toPatchValue(field: SettingField, value: SettingValue | null): SettingValue | null {
  if ((field.type === "integer" || field.type === "number") && typeof value === "string") {
    if (value.trim() === "") return null;
    return Number(value);
  }
  return value;
}

function localIssue(field: SettingField, value: SettingValue | null): string | null {
  if (value === null || typeof value !== "string" || (field.type !== "integer" && field.type !== "number")) return null;
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || (field.type === "integer" && !Number.isInteger(n))) return field.type === "integer" ? "Enter a whole number." : "Enter a number.";
  if (field.min !== undefined && n < field.min) return `Enter ${fmtInt(field.min)} or more.`;
  if (field.max !== undefined && n > field.max) return `Enter ${fmtInt(field.max)} or less.`;
  return null;
}

/**
 * Edits a set of settings and saves them together. PATCH is all-or-nothing: on a 400 every field keeps its edit
 * and the failing ones show the server's reason.
 */
export function useSettingsForm(keys: string[]) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const fields = useMemo(() => fieldsByKey(settings.data), [settings.data]);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [effects, setEffects] = useState<SettingsEffect[]>([]);
  const [saving, setSaving] = useState(false);

  const dirtyKeys = keys.filter((k) => k in draft);
  const set = (key: string, value: SettingValue | null) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      const { [key]: _removed, ...rest } = e;
      return rest;
    });
  };
  const revert = (key?: string) => {
    if (key === undefined) {
      setDraft({});
      setErrors({});
      setProblem(null);
      return;
    }
    setDraft(({ [key]: _removed, ...rest }) => rest);
  };
  const value = (key: string): SettingValue | null => (key in draft ? draft[key]! : (fields.get(key)?.value ?? null));

  const save = async (): Promise<boolean> => {
    const local: Record<string, string> = {};
    const body: Record<string, SettingValue | null> = {};
    for (const key of dirtyKeys) {
      const field = fields.get(key);
      if (!field) continue;
      const issue = localIssue(field, draft[key]!);
      if (issue) local[key] = issue;
      body[key] = toPatchValue(field, draft[key]!);
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return false;
    }
    setSaving(true);
    setProblem(null);
    try {
      const result = await request<SettingsPatchResult>("/api/settings", { method: "PATCH", json: body });
      const { changed: _changed, effects: next, ...fresh } = result;
      queryClient.setQueryData(["settings"], fresh);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !dirtyKeys.includes(k))));
      setErrors({});
      setEffects(next);
      for (const effect of next) if (effect.type === "discord_commands_registered") showToast(`Registered ${fmtInt(effect.count)} Discord commands`);
      if (next.length === 0) showToast("Saved");
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_settings" && Array.isArray(error.details)) {
        const issues = error.details as unknown as SettingIssue[];
        setErrors(Object.fromEntries(issues.map((i) => [i.key, issueText(i)])));
        const stray = issues.filter((i) => !keys.includes(i.key));
        if (stray.length > 0) setProblem(stray.map(issueText).join(" "));
      } else setProblem(describeError(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { settings, fields, draft, errors, problem, effects, saving, dirty: dirtyKeys.length > 0, set, revert, value, save, dismissEffects: () => setEffects([]) };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;

function issueText(issue: SettingIssue): string {
  if (issue.reason === "locked") return "Set by an environment variable on the server. Change it there.";
  if (issue.reason === "secrets_key_missing") return "Set SECRETS_KEY on the server to store keys here.";
  return issue.message.charAt(0).toUpperCase() + issue.message.slice(1).replace(/\.?$/, ".");
}

function FieldControl({ field, form, control, placeholder }: { field: SettingField; form: SettingsForm; control: SettingControlProps; placeholder?: string }) {
  const v = form.value(field.key);
  const zones = useZoneOptions(field);
  const label = settingLabel(field.key);
  if (field.type === "timezone")
    return <Combobox {...control} value={typeof v === "string" ? v : null} onChange={(z) => form.set(field.key, z)} options={zones} placeholder="Search time zones" />;
  if (field.type === "weekdays")
    return <WeekdayPicker id={control.id} aria-describedby={control["aria-describedby"]} label={label} value={Array.isArray(v) ? v : []} onChange={(days) => form.set(field.key, days)} />;
  if (field.type === "boolean")
    return (
      <div className="flex h-(--control-h) items-center md:justify-end">
        <Switch label={label} checked={v === true} onChange={(on) => form.set(field.key, on)} />
      </div>
    );
  if (field.type === "enum")
    return (
      <Select
        label={label}
        value={String(v ?? "")}
        onChange={(next) => form.set(field.key, next)}
        options={(field.options ?? []).map((o) => ({ value: o, label: ENUM_LABELS[o] ?? o }))}
        className="w-full"
      />
    );
  if (field.unit === "weekday")
    return (
      <Select label={label} value={String(v ?? "")} onChange={(d) => form.set(field.key, Number(d))} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} className="w-full" />
    );
  if (field.unit === "hour")
    return (
      <Select
        label={label}
        value={String(v ?? "")}
        onChange={(h) => form.set(field.key, Number(h))}
        options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: fmtHour(h) }))}
        className="w-full"
      />
    );
  if (field.type === "integer" || field.type === "number")
    return (
      <Input
        {...control}
        inputMode={field.type === "integer" ? "numeric" : "decimal"}
        value={v === null ? "" : String(v)}
        placeholder={placeholder ?? (field.default === null ? undefined : String(field.default))}
        onChange={(e) => form.set(field.key, e.target.value)}
        end={field.unit ? <span className="shrink-0 text-tertiary">{UNIT_LABELS[field.unit]}</span> : undefined}
      />
    );
  return (
    <Input
      {...control}
      value={typeof v === "string" ? v : ""}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => form.set(field.key, field.key === "homeCountry" ? e.target.value.toUpperCase() : e.target.value)}
    />
  );
}

function SecretControl({ field, form, control, storage }: { field: SettingField; form: SettingsForm; control: SettingControlProps; storage: boolean }) {
  const editing = field.key in form.draft;
  const v = form.draft[field.key];
  if (editing && v === null)
    return (
      <div className="flex h-(--control-h) items-center justify-between gap-3">
        <span className="text-secondary">Removed when you save</span>
        <Button size="sm" variant="ghost" onClick={() => form.revert(field.key)}>
          Keep
        </Button>
      </div>
    );
  if (editing)
    return (
      <div className="flex items-center gap-2">
        <Input {...control} type="password" autoComplete="off" spellCheck={false} value={typeof v === "string" ? v : ""} onChange={(e) => form.set(field.key, e.target.value)} className="flex-1" autoFocus />
        <Button size="sm" variant="ghost" onClick={() => form.revert(field.key)}>
          Cancel
        </Button>
      </div>
    );
  return (
    <div className="flex min-h-(--control-h) flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span id={control.id} className={field.unreadable ? "text-warning" : field.set ? "text-primary" : "text-secondary"}>
        {field.unreadable ? "Stored, but unreadable" : displayValue(field)}
      </span>
      <span className="flex gap-1">
        {field.set && field.source === "db" && (
          <Button size="sm" variant="ghost" onClick={() => form.set(field.key, null)}>
            Clear
          </Button>
        )}
        <Button size="sm" disabled={!storage} onClick={() => form.set(field.key, "")}>
          {field.set || field.unreadable ? "Replace" : "Add"}
        </Button>
      </span>
    </div>
  );
}

/** One field: the right control for its type, read-only when an env var sets it. `hint` overrides the stock hint. */
export function SettingFieldRow({ field, form, hint, placeholder, storage = true }: { field: SettingField; form: SettingsForm; hint?: ReactNode; placeholder?: string; storage?: boolean }) {
  const label = settingLabel(field.key);
  if (field.locked)
    return (
      <SettingRow label={label} hint={`Set by ${field.env} on the server${field.stored ? ", also saved here" : ""}.`}>
        {(control) => (
          <p id={control.id} className="flex min-h-(--control-h) items-center break-all text-primary md:justify-end md:text-right">
            {displayValue(field)}
          </p>
        )}
      </SettingRow>
    );
  const unreadable = field.unreadable && !(field.key in form.draft) ? "The stored value cannot be read with the current SECRETS_KEY. Save it again." : null;
  return (
    <SettingRow label={label} hint={unreadable ?? hint ?? settingHint(field.key)} error={form.errors[field.key]} wide={field.type === "weekdays"}>
      {(control) => (field.secret ? <SecretControl field={field} form={form} control={control} storage={storage} /> : <FieldControl field={field} form={form} control={control} placeholder={placeholder} />)}
    </SettingRow>
  );
}

const EFFECT_TEXT: Partial<Record<SettingsEffect["type"], string>> = {
  spotify_disconnected: "Spotify is disconnected: the connection belonged to the old client ID. Connect again to keep logging plays.",
};

/** What a save changed beyond the values: shown under the section until dismissed or the next save. */
export function Effects({ form, spotifyAction }: { form: SettingsForm; spotifyAction?: ReactNode }) {
  return (
    <>
      {form.effects.map((effect) => {
        if (effect.type === "discord_commands_registered") return null;
        if (effect.type === "discord_registration_failed")
          return (
            <Notice key={effect.type} tone="warning">
              Saved, but Discord refused the commands: {effect.message}
            </Notice>
          );
        const text = EFFECT_TEXT[effect.type];
        if (!text) return null;
        return (
          <Notice key={effect.type} tone={effect.type === "spotify_disconnected" ? "warning" : "info"} action={effect.type === "spotify_disconnected" ? spotifyAction : undefined}>
            {text}
          </Notice>
        );
      })}
    </>
  );
}

/** Save and Cancel for a section, shown while it has unsaved edits. */
export function SaveBar({ form, label = "Save" }: { form: SettingsForm; label?: string }) {
  if (!form.dirty && !form.problem) return null;
  return (
    <div className="flex flex-col gap-3">
      {form.problem && <Notice tone="danger">{form.problem}</Notice>}
      {form.dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => form.revert()} disabled={form.saving}>
            Cancel
          </Button>
          <Button variant="primary" busy={form.saving} busyLabel="Saving" onClick={() => void form.save()}>
            {label}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A titled block of settings with its own save. */
export function SettingsBlock({
  title,
  description,
  keys,
  form,
  hints,
  placeholders,
  storage,
  children,
  footer,
  effectAction,
}: {
  title?: string;
  description?: ReactNode;
  keys: string[];
  form: SettingsForm;
  hints?: Record<string, ReactNode>;
  placeholders?: Record<string, string>;
  storage?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  effectAction?: ReactNode;
}) {
  const fields = keys.map((k) => form.fields.get(k)).filter((f): f is SettingField => f !== undefined);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      {(title || description) && (
        <div className="flex flex-col gap-0.5">
          {title && <h2 className="text-heading font-medium text-primary">{title}</h2>}
          {description && <p className="text-secondary text-pretty">{description}</p>}
        </div>
      )}
      <SettingRows>
        {fields.map((f) => (
          <SettingFieldRow key={f.key} field={f} form={form} hint={hints?.[f.key]} placeholder={placeholders?.[f.key]} storage={storage} />
        ))}
        {children}
      </SettingRows>
      {footer}
      <Effects form={form} spotifyAction={effectAction} />
      <SaveBar form={form} />
    </section>
  );
}
