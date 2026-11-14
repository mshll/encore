import { eq } from "drizzle-orm";
import { pricedModels, type Config } from "../config";
import type { Db } from "../db/client";
import { settings as settingsTable } from "../db/schema";
import { settingFields, type SettingField, type SettingValue } from "./fields";
import { SecretBox, SecretUnreadableError } from "./secretBox";
import { resolveSettings, type RawSettings, type Settings, type SettingsSource } from "./settings";

export type SettingSource = "env" | "db" | "default";

export type SettingEntry = {
  field: SettingField;
  value: SettingValue | null;
  source: SettingSource;
  /** A stored secret that SECRETS_KEY cannot open. The setting then falls back to its default. */
  unreadable: boolean;
};

export type SettingIssueReason = "unknown" | "locked" | "invalid" | "secrets_key_missing";
export type SettingIssue = { key: string; reason: SettingIssueReason; message: string };

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
    this.fields = settingFields(pricedModels(config.llmPrices));
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
    if (issues.length) throw new SettingsValidationError(issues);

    const before = this.load();
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
    const after = this.load();
    const changed = writes.map((w) => w.field.key).filter((key) => !sameValue(before.get(key)!.value, after.get(key)!.value));
    if (changed.length) for (const listener of this.listeners) listener(changed);
    return changed;
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): Map<string, SettingEntry> {
    if (this.entries) return this.entries;
    const stored = new Map(this.db.select().from(settingsTable).all().map((row) => [row.key, row.value]));
    this.entries = new Map(this.fields.map((field) => [field.key, this.resolve(field, stored.get(field.key))]));
    return this.entries;
  }

  private resolve(field: SettingField, stored: unknown): SettingEntry {
    const env = this.config.envSettings[field.key];
    if (env !== undefined) return { field, value: env, source: "env", unreadable: false };
    const fallback: SettingEntry = { field, value: field.default, source: "default", unreadable: false };
    if (stored === undefined) return fallback;
    let candidate = stored;
    if (field.secret) {
      try {
        if (!this.box) throw new SecretUnreadableError("SECRETS_KEY is not set");
        candidate = this.box.open(String(stored));
      } catch (error) {
        if (!(error instanceof SecretUnreadableError)) throw error;
        this.warnOnce(field.key, `stored secret ${field.key} cannot be read (${error.message}); it is ignored until saved again`);
        return { ...fallback, unreadable: true };
      }
    }
    const parsed = field.schema.safeParse(candidate);
    if (!parsed.success) {
      this.warnOnce(field.key, `stored value for ${field.key} is invalid (${parsed.error.issues[0]!.message}); using the default`);
      return fallback;
    }
    return { field, value: parsed.data, source: "db", unreadable: false };
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[settings] ${message}`);
  }
}
