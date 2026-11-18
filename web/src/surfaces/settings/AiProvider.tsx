import { useState } from "react";
import { request } from "../../api/client";
import type { AiKeyCheck, AiProvider, SettingValue } from "../../api/types";
import { Button } from "../../ui/Button";
import { SettingRow } from "../../ui/SettingRow";
import { describeError } from "../../ui/States";
import type { SettingsForm } from "./form";
export const PROVIDER_NAMES: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google Gemini", "openai-compatible": "OpenAI-compatible" };

const text = (v: SettingValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
const price = (v: SettingValue | null | undefined) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** The provider, model, key and address as the form holds them now, saved or not, with the earlier Anthropic fields filling in. */
export function draftAi(form: SettingsForm) {
  const provider = (text(form.value("aiProvider")) ?? "anthropic") as AiProvider;
  const anthropic = provider === "anthropic";
  return {
    provider,
    model: text(form.value("aiModel")) ?? (anthropic ? text(form.value("claudeModel")) : null),
    legacyKey: anthropic && !form.fields.get("aiApiKey")?.set ? form.fields.get("claudeApiKey") : undefined,
    compatible: provider === "openai-compatible",
  };
}

export function VerifyAi({ form, configured }: { form: SettingsForm; configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const edited = ["aiProvider", "aiModel", "aiApiKey", "aiBaseUrl"].filter((k) => k in form.draft && text(form.draft[k]!) !== null);
  const inputPrice = price(form.draft.aiInputPrice);
  const outputPrice = price(form.draft.aiOutputPrice);
  if (!configured && edited.length === 0) return null;
  const verify = async () => {
    setBusy(true);
    setResult(null);
    const body = {
      ...Object.fromEntries(edited.map((k) => [{ aiProvider: "provider", aiModel: "model", aiApiKey: "apiKey", aiBaseUrl: "baseUrl" }[k]!, text(form.draft[k]!)])),
      ...(inputPrice !== null && outputPrice !== null ? { inputPrice, outputPrice } : {}),
    };
    try {
      const r = await request<AiKeyCheck>("/api/settings/ai/verify", { json: body });
      setResult(r.valid ? { ok: true, text: `${r.model} answered.` } : { ok: false, text: r.message });
    } catch (error) {
      setResult({ ok: false, text: describeError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow label="Check the connection" hint={result?.ok ? result.text : undefined} error={result && !result.ok ? result.text : null}>
      {() => (
        <div className="flex md:justify-end">
          <Button size="sm" busy={busy} busyLabel="Checking" onClick={() => void verify()}>
            {edited.length ? "Check before saving" : "Check"}
          </Button>
        </div>
      )}
    </SettingRow>
  );
}
