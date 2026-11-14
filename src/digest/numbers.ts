const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const DAY = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Every number a digest may state: the facts' numbers, their rounded and percent forms, date parts, and 12-hour clock forms of hours. */
export function allowedNumbers(facts: unknown): Set<number> {
  const allowed = new Set<number>([0]);
  const add = (n: number) => {
    for (const v of [n, Math.abs(n)]) for (const x of [v, r(v, 0), r(v, 1), r(v * 100, 0), r(v * 100, 1)]) allowed.add(x);
  };
  const walk = (value: unknown, key: string) => {
    if (typeof value === "number") {
      add(value);
      if (key === "hour") allowed.add(value % 12 || 12);
    } else if (typeof value === "string") {
      const m = DAY.exec(value);
      if (m) for (const part of m.slice(1)) if (part) allowed.add(Number(part));
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(facts, "");
  return allowed;
}

/** Numbers in the text that are not in `allowed`, as written. */
export function unsupportedNumbers(text: string, allowed: Set<number>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const n = Number(match[0].replace(/,/g, ""));
    if (![...allowed].some((a) => Math.abs(a - n) < 1e-9)) out.push(match[0]);
  }
  return [...new Set(out)];
}
