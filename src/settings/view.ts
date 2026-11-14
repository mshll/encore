import { SETTING_GROUPS, type SettingGroup, type SettingType, type SettingUnit, type SettingValue } from "./fields";
import type { SettingEntry, SettingSource, SettingsStore } from "./store";

export type SettingFieldView = {
  key: string;
  env: string;
  type: SettingType;
  secret: boolean;
  value: SettingValue | null;
  default: SettingValue | null;
  source: SettingSource;
  locked: boolean;
  set: boolean;
  hint: string | null;
  unreadable: boolean;
  min?: number;
  max?: number;
  unit?: SettingUnit;
  options?: readonly string[];
};

export type SettingsView = {
  groups: { id: SettingGroup; fields: SettingFieldView[] }[];
  secretStorage: { available: boolean; envVar: "SECRETS_KEY" };
};

const HINT_MIN_LENGTH = 16;

/** Last four characters of a long secret, so the owner can tell which one is set. Short secrets get none. */
const hintOf = (value: SettingValue | null) => (typeof value === "string" && value.length >= HINT_MIN_LENGTH ? value.slice(-4) : null);

export function fieldView({ field, value, source, unreadable }: SettingEntry): SettingFieldView {
  return {
    key: field.key,
    env: field.env,
    type: field.type,
    secret: field.secret,
    value: field.secret ? null : value,
    default: field.secret ? null : field.default,
    source,
    locked: source === "env",
    set: value !== null,
    hint: field.secret ? hintOf(value) : null,
    unreadable,
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.options ? { options: field.options } : {}),
  };
}

export function settingsView(store: SettingsStore): SettingsView {
  const entries = store.list();
  return {
    groups: SETTING_GROUPS.map((id) => ({ id, fields: entries.filter((e) => e.field.group === id).map(fieldView) })),
    secretStorage: { available: store.canStoreSecrets, envVar: "SECRETS_KEY" },
  };
}
