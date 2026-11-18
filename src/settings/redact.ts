import type { SettingsStore } from "./store";

const MIN_REDACTED = 4;

/** `text` with every given secret replaced, so an error that echoes a key or URL can be stored, logged or sent. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= MIN_REDACTED) out = out.replaceAll(secret, "[redacted]");
  return out;
}

/** Every secret setting's current value. */
export function secretValues(store: Pick<SettingsStore, "list">): string[] {
  return store
    .list()
    .filter((entry) => entry.field.secret && typeof entry.value === "string")
    .map((entry) => entry.value as string);
}
