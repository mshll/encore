import { eq } from "drizzle-orm";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { settings as settingsTable } from "../db/schema";
import { settingFields, type SettingField, type SettingValue } from "./fields";
import { localTime } from "../plays/localTime";
import { SecretBox, SecretUnreadableError } from "./secretBox";
import { resolveSettings, type RawSettings, type Settings, type SettingsSource } from "./settings";

export type SettingSource = "env" | "db" | "default";

export type SettingEntry = {
  field: SettingField;
  value: SettingValue | null;
  source: SettingSource;
  /** A stored secret that SECRETS_KEY cannot open. The setting then falls back to its default. */
  unreadable: boolean;
  /** The table holds a valid value for this key, which applies whenever no env var sets it. */
  stored: boolean;
};

export type SettingIssueReason = "unknown" | "locked" | "invalid" | "secrets_key_missing";
export type SettingIssue = { key: string; reason: SettingIssueReason; message: string };

export type AdoptSkip = { key: string; reason: "invalid" | "secrets_key_missing" };
export type AdoptResult = { adopted: string[]; replaced: string[]; skipped: AdoptSkip[] };

type StoredRead = { ok: true; value: SettingValue } | { ok: false; unreadable: boolean; message: string };

export class SettingsValidationError extends Error {
  constructor(readonly issues: SettingIssue[]) {
    super(issues.map((i) => `${i.key}: ${i.message}`).join("; "));
  }
}

export type SettingsListener = (changed: string[]) => void;

const sameValue = (a: SettingValue | null, b: SettingValue | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings with precedence env, then the settings table, then the default. Secrets are sealed with SECRETS_KEY
 * before they are stored and are never returned in full.
 */
export class SettingsStore implements SettingsSource {
  readonly fields: SettingField[];
  private readonly byKey: Map<string, SettingField>;
  private readonly box: SecretBox | null;
  private entries: Map<string, SettingEntry> | null = null;
  private resolved: Settings | null = null;
  private readonly listeners = new Set<SettingsListener>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, "envSettings" | "secretsKey" | "llmPrices">,
    private readonly now: () => number = Date.now,
  ) {
    this.fields = settingFields();
    this.byKey = new Map(this.fields.map((f) => [f.key, f]));
    this.box = config.secretsKey ? new SecretBox(config.secretsKey) : null;
  }

  get canStoreSecrets(): boolean {
    return this.box !== null;
  }

  get(): Settings {
    if (!this.resolved) {
      const raw = Object.fromEntries([...this.load().values()].filter((e) => e.value !== null).map((e) => [e.field.key, e.value]));
      this.resolved = resolveSettings(raw as RawSettings, this.config.llmPrices);
    }
    return this.resolved;
  }

  list(): SettingEntry[] {
    return [...this.load().values()];
  }

  entry(key: string): SettingEntry | undefined {
    return this.load().get(key);
  }

  /** Validates every value first, then writes all or none. `null` or "" clears a stored value. Returns the keys whose effective value changed. */
  update(patch: Record<string, unknown>): string[] {
    const writes = this.parsePatch(patch);
    const before = this.load();
    this.write(writes);
    const after = this.load();
    const changed = writes.map((w) => w.field.key).filter((key) => !sameValue(before.get(key)!.value, after.get(key)!.value));
    if (changed.length) for (const listener of this.listeners) listener(changed);
    return changed;
  }

  /** Throws the `SettingsValidationError` that `update` would throw for this patch, without writing. */
  validate(patch: Record<string, unknown>): void {
    this.parsePatch(patch);
  }

  private parsePatch(patch: Record<string, unknown>): { field: SettingField; value: SettingValue | null }[] {
    const issues: SettingIssue[] = [];
    const writes: { field: SettingField; value: SettingValue | null }[] = [];
    for (const [key, input] of Object.entries(patch)) {
      const field = this.byKey.get(key);
      if (!field) {
        issues.push({ key, reason: "unknown", message: "Unknown setting" });
        continue;
      }
      if (key in this.config.envSettings) {
        issues.push({ key, reason: "locked", message: `Set by the ${field.env} environment variable; change it there` });
        continue;
      }
      if (input === null || input === "") {
        writes.push({ field, value: null });
        continue;
      }
      const parsed = field.schema.safeParse(input);
      if (!parsed.success) {
        issues.push({ key, reason: "invalid", message: parsed.error.issues[0]!.message });
        continue;
      }
      if (field.secret && !this.box) {
        issues.push({ key, reason: "secrets_key_missing", message: "SECRETS_KEY is not set, so secrets can only come from environment variables" });
        continue;
      }
      writes.push({ field, value: parsed.data });
    }
    const today = localTime(this.now(), this.timezoneAfter(writes)).day;
    for (const { field, value } of writes) {
      if (field.type === "date" && typeof value === "string" && value > today) issues.push({ key: field.key, reason: "invalid", message: "must not be in the future" });
    }
    if (issues.length) throw new SettingsValidationError(issues);
    return writes;
  }

  private timezoneAfter(writes: { field: SettingField; value: SettingValue | null }[]): string {
    const write = writes.find((w) => w.field.key === "timezone");
    return write ? String(write.value ?? write.field.default) : this.get().timezone;
  }

  /**
   * Copies every env-provided value into the table, so it still applies once the env var is removed. Env keeps
   * precedence, so no effective value changes and no listener fires. A stored value that differs is replaced.
   */
  adoptEnv(): AdoptResult {
    const rows = this.rows();
    const writes: { field: SettingField; value: SettingValue }[] = [];
    const replaced: string[] = [];
    const skipped: AdoptSkip[] = [];
    for (const field of this.fields) {
      const env = this.config.envSettings[field.key];
      if (env === undefined) continue;
      const parsed = field.schema.safeParse(env);
      if (!parsed.success) {
        skipped.push({ key: field.key, reason: "invalid" });
        continue;
      }
      if (field.secret && !this.box) {
        skipped.push({ key: field.key, reason: "secrets_key_missing" });
        continue;
      }
      const raw = rows.get(field.key);
      const current = raw === undefined ? undefined : this.readStored(field, raw);
      if (current?.ok && sameValue(current.value, parsed.data)) continue;
      if (raw !== undefined) replaced.push(field.key);
      writes.push({ field, value: parsed.data });
    }
    this.write(writes);
    return { adopted: writes.map((w) => w.field.key), replaced, skipped };
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(writes: { field: SettingField; value: SettingValue | null }[]) {
    if (!writes.length) return;
    const at = this.now();
    this.db.transaction((tx) => {
      for (const { field, value } of writes) {
        if (value === null) {
          tx.delete(settingsTable).where(eq(settingsTable.key, field.key)).run();
          continue;
        }
        const stored = field.secret ? this.box!.seal(String(value)) : value;
        tx.insert(settingsTable)
          .values({ key: field.key, value: stored, updatedAt: at })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: stored, updatedAt: at } })
          .run();
      }
    });
    for (const { field } of writes) this.warned.delete(field.key);
    this.entries = null;
    this.resolved = null;
  }

  private rows(): Map<string, unknown> {
    return new Map(this.db.select().from(settingsTable).all().map((row) => [row.key, row.value]));
  }

  private load(): Map<string, SettingEntry> {
    if (this.entries) return this.entries;
    const rows = this.rows();
    this.entries = new Map(this.fields.map((field) => [field.key, this.resolve(field, rows.get(field.key))]));
    return this.entries;
  }

  private resolve(field: SettingField, raw: unknown): SettingEntry {
    const stored = raw === undefined ? undefined : this.readStored(field, raw);
    const env = this.config.envSettings[field.key];
    if (env !== undefined) return { field, value: env, source: "env", unreadable: false, stored: stored?.ok === true };
    const fallback: SettingEntry = { field, value: field.default, source: "default", unreadable: false, stored: false };
    if (!stored) return fallback;
    if (!stored.ok) {
      this.warnOnce(field.key, stored.message);
      return { ...fallback, unreadable: stored.unreadable };
    }
    return { field, value: stored.value, source: "db", unreadable: false, stored: true };
  }

  private readStored(field: SettingField, raw: unknown): StoredRead {
    let candidate = raw;
    if (field.secret) {
      try {
        if (!this.box) throw new SecretUnreadableError("SECRETS_KEY is not set");
        candidate = this.box.open(String(raw));
      } catch (error) {
        if (!(error instanceof SecretUnreadableError)) throw error;
        return { ok: false, unreadable: true, message: `stored secret ${field.key} cannot be read (${error.message}); it is ignored until saved again` };
      }
    }
    const parsed = field.schema.safeParse(candidate);
    if (!parsed.success) return { ok: false, unreadable: false, message: `stored value for ${field.key} is invalid (${parsed.error.issues[0]!.message}); using the default` };
    return { ok: true, value: parsed.data };
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[settings] ${message}`);
  }
}
