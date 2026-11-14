export const DEFAULT_TIMEZONE = "Asia/Kuwait";

const pad = (n: number) => String(n).padStart(2, "0");

export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function monthSequence(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number) as [number, number];
  for (;;) {
    const current = `${y}-${pad(m)}`;
    out.push(current);
    if (current >= last) return out;
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
}

export function daySequence(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const iso = (d.getUTCDay() + 6) % 7;
  return addDays(day, -iso);
}

export function weekSequence(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = weekStart(first); d <= last; d = addDays(d, 7)) out.push(d);
  return out;
}

export function yearSequence(first: string, last: string): string[] {
  const out: string[] = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) out.push(String(y));
  return out;
}
