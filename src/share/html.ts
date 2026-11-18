import { plainValue } from "../answers/answer";
import { axisLabel, type PublicVisual } from "../answers/card";
import { MARK_PATH } from "../covers/mark";
import type { AnswerSnapshot, RecapSnapshot, ShareSnapshot, SnapshotSection } from "./snapshot";

/*
  The public share page: server-rendered HTML with no script at all, every value escaped. Styles are inline in a
  <style> element (the CSP allows inline styles, never inline scripts). Images are Spotify CDN art only.
*/

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The dither-kit halftone at one density (0 to 16) as an SVG data URI for a CSS background. */
function ditherTile(level: number): string {
  const rects = BAYER4.flatMap((row, y) => row.flatMap((v, x) => (level / 16 > (v + 0.5) / 16 ? [`<rect x='${x}' y='${y}' width='1' height='1'/>`] : []))).join("");
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4' shape-rendering='crispEdges' fill='rgb(30,215,96)'>${rects}</svg>`)}")`;
}

const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%`;
const count = (n: number) => new Intl.NumberFormat("en-GB").format(n);
const hours = (h: number) => (h <= 0 ? "none" : h < 1 ? `${Math.round(h * 60)} min` : h < 10 ? `${Math.round(h * 10) / 10} h` : `${count(Math.round(h))} h`);
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
const tag = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ");
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const month = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const spotifyUrl = (uri: string | null) => {
  const m = uri?.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  return m ? `https://open.spotify.com/track/${m[1]}` : null;
};
const art = (src: string | null, round = false) =>
  src && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//.test(src) ? `<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" class="art${round ? " round" : ""}">` : `<span class="art${round ? " round" : ""}"></span>`;

const bar = (share: number, label: string, before?: number | null) =>
  `<span class="bar" role="img" aria-label="${esc(label)}"><span class="fill" style="width:${pct(share)}"></span>${before != null ? `<span class="tick" style="left:${pct(before)}"></span>` : ""}</span>`;
const pair = (now: number, before: number, label: string) => {
  const max = Math.max(now, before) || 1;
  return `<span class="pair" role="img" aria-label="${esc(label)}"><span class="now" style="width:${pct(now / max)}"></span><span class="before" style="width:${pct(before / max)}"></span></span>`;
};
const change = (now: number, before: number) => {
  if (before <= 0) return "new";
  const c = Math.round(((now - before) / before) * 100);
  return c === 0 ? "no change" : `${c > 0 ? "↑" : "↓"} ${Math.abs(c)}%`;
};
const columns = (values: number[], mark: number, label: string, bars: number) => {
  const step = Math.max(1, Math.ceil(values.length / bars));
  const cols = Array.from({ length: Math.ceil(values.length / step) }, (_, i) => values.slice(i * step, (i + 1) * step).reduce((a, b) => a + b, 0));
  const max = Math.max(...cols, 0) || 1;
  const markCol = Math.floor(mark / step);
  return `<span class="cols" role="img" aria-label="${esc(label)}">${cols.map((v, i) => `<span class="${v === 0 ? "col empty" : i === markCol ? "col mark" : "col"}" style="height:${v === 0 ? "2px" : pct(Math.max(0.15, v / max))}"></span>`).join("")}</span>`;
};
const take = (t: string | null) => (t ? `<p class="take">${esc(t)}</p>` : "");

type Of<K extends SnapshotSection["id"]> = Extract<SnapshotSection, { id: K }>;

function sectionHtml(s: SnapshotSection, r: RecapSnapshot["recap"]): string {
  const compare = r.compare?.label ?? null;
  switch (s.id) {
    case "listening": {
      const busiest = s.daily ? s.daily.indexOf(Math.max(...s.daily)) : -1;
      return `<section><h2>Listening</h2>${take(s.take)}<p class="figure">${esc(hours(s.hours))}</p>${
        compare && s.before !== null ? `<p class="line">${pair(s.hours, s.before, `${hours(s.hours)}, against ${hours(s.before)} in ${compare}`)}<span class="muted">${esc(change(s.hours, s.before))} against ${esc(hours(s.before))} in ${esc(compare)}</span></p>` : ""
      }<p class="muted">${esc(plural(s.listens, "play", "plays"))}, ${esc(plural(s.artists, "artist", "artists"))}, ${esc(plural(s.songs, "song", "songs"))}</p>${
        s.daily && s.daily.length > 1 && busiest >= 0 ? `<p class="line">${columns(s.daily, busiest, `Listening each ${r.kind === "yearly" ? "week" : "day"}`, r.kind === "yearly" ? 53 : 31)}</p>` : ""
      }</section>`;
    }
    case "months": {
      const max = Math.max(...s.months.map((m) => m.hours)) || 1;
      return `<section><h2>Month by month</h2>${take(s.take)}<ol class="rows">${s.months
        .map((m) => `<li class="grid months"><span class="muted">${esc(month(m.month))}</span>${bar(m.hours / max, `${hours(m.hours)} in ${month(m.month)}`)}<span class="num">${esc(hours(m.hours))}</span><span class="name">${m.artist ? `${art(m.imageUrl, true)}<span class="clip">${esc(m.artist)}</span>` : ""}</span></li>`)
        .join("")}</ol></section>`;
    }
    case "artists": {
      const top = s.top[0]?.share || 1;
      const movers = (title: string, list: Of<"artists">["up"]) =>
        list.length && compare
          ? `<div><h3>${esc(title)} ${esc(compare)}</h3><ul class="rows">${list.map((a) => `<li class="line"><span class="name">${art(a.imageUrl, true)}<span class="clip">${esc(a.artist)}</span></span>${pair(a.hours, a.before ?? 0, `${a.artist}: ${hours(a.hours)}, from ${hours(a.before ?? 0)}`)}<span class="muted num">${esc(hours(a.before ?? 0))} to ${esc(hours(a.hours))}</span></li>`).join("")}</ul></div>`
          : "";
      return `<section><h2>Artists</h2>${take(s.take)}<ol class="rows">${s.top
        .slice(0, 5)
        .map((a, i) => `<li class="grid artists"><span class="rank">${i + 1}</span><span class="name">${art(a.imageUrl, true)}<span class="clip">${esc(a.artist)}</span></span>${bar(a.share / top, `${Math.round(a.share * 100)}% of the listening`)}<span class="num">${esc(hours(a.hours))}</span></li>`)
        .join("")}</ol>${movers("More than", s.up)}${movers("Less than", s.down)}</section>`;
    }
    case "songs":
      return `<section><h2>Songs</h2>${take(s.take)}<ol class="rows">${s.songs
        .slice(0, 10)
        .map((t, i) => {
          const url = spotifyUrl(t.uri);
          const name = `<span class="clip"><span class="song">${esc(t.name)}</span> <span class="muted">${esc(t.artist)}</span></span>`;
          return `<li class="grid songs"><span class="rank">${i + 1}</span><span class="name">${art(t.albumArtUrl)}${url ? `<a href="${esc(url)}" rel="noreferrer noopener" target="_blank">${name}</a>` : name}</span><span class="num muted">${esc(plural(t.listens, "play", "plays"))}</span></li>`;
        })
        .join("")}</ol></section>`;
    case "taste": {
      const rows = (title: string, list: Of<"taste">["genres"]) =>
        list.length
          ? `<div><h3>${esc(title)}</h3><ul class="rows">${list.map((g) => `<li class="grid taste"><span class="clip">${esc(tag(g.value))}</span>${bar(g.share, `${Math.round(g.share * 100)}% from ${Math.round((g.before ?? 0) * 100)}%`, g.before)}<span class="num muted">${Math.round(g.share * 100)}% from ${Math.round((g.before ?? 0) * 100)}%</span></li>`).join("")}</ul></div>`
          : "";
      return `<section><h2>Genres and moods</h2>${take(s.take)}<div class="two">${rows("Genres", s.genres)}${rows("Moods", s.moods)}</div></section>`;
    }
    case "finds":
      return `<section><h2>New finds</h2>${take(s.take)}${
        s.songs.count ? `<p>${esc(`${count(s.songs.count)} of ${plural(s.songs.ofNew, "new song", "new songs")} came back on another day`)}</p><ul class="rows">${s.songs.top.map((t) => `<li class="line"><span class="name">${art(t.albumArtUrl)}<span class="clip">${esc(t.name)} <span class="muted">${esc(t.artist)}</span></span></span></li>`).join("")}</ul>` : ""
      }${s.artists.count ? `<p>${esc(`${count(s.artists.count)} of ${plural(s.artists.ofNew, "new artist", "new artists")} came back on another day`)}</p><ul class="rows">${s.artists.top.map((a) => `<li class="line"><span class="name">${art(a.imageUrl, true)}<span class="clip">${esc(a.artist)}</span></span></li>`).join("")}</ul>` : ""}</section>`;
    case "rhythm":
      return `<section><h2>When</h2>${take(s.take)}<p>Busiest day: ${esc(day(s.day.day))}, ${esc(hours(s.day.hours))}</p>${
        s.hour ? `<p class="line"><span>Busiest hour: ${esc(hour(s.hour.hour))} to ${esc(hour((s.hour.hour + 1) % 24))}</span>${s.byHour ? columns(s.byHour, s.hour.hour, `Listening by hour of the day; the most from ${hour(s.hour.hour)}`, 24) : ""}</p>` : ""
      }</section>`;
  }
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--text:#202020;--muted:#696969;--faint:#878787;--empty:#0000000a;--axis:#00000070;--line:#0000001a}
@media (prefers-color-scheme:dark){:root{--bg:#111;--text:#eee;--muted:#a9a9a9;--faint:#787878;--empty:#ffffff0d;--axis:#ffffff6b;--line:#ffffff1a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;flex-direction:column;gap:12px;margin-bottom:48px}
.brand{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px}
.brand svg{width:20px;height:20px;fill:currentColor}
h1{font-size:clamp(28px,6vw,40px);line-height:1.1;letter-spacing:-0.02em;margin:0;text-wrap:balance;overflow-wrap:anywhere}
h2{font-size:18px;margin:0 0 12px}
h3{font-size:14px;font-weight:500;color:var(--muted);margin:16px 0 8px}
p{margin:0 0 8px}
section{margin-bottom:48px}
.muted{color:var(--muted)}
.take{max-width:60ch;text-wrap:pretty}
.figure{font-size:40px;font-weight:600;letter-spacing:-0.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}
.rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.grid{display:grid;align-items:center;gap:12px;min-height:28px}
.artists{grid-template-columns:20px minmax(0,1fr) 64px 56px}
.songs{grid-template-columns:20px minmax(0,1fr) auto}
.months{grid-template-columns:40px 64px 56px minmax(0,1fr)}
.taste{grid-template-columns:minmax(0,1fr) 64px auto}
.two{display:grid;gap:8px 32px}
@media (min-width:640px){.two{grid-template-columns:1fr 1fr}}
.rank{color:var(--faint);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.name{display:flex;align-items:center;gap:8px;min-width:0}
.name a{color:inherit;text-decoration:none;min-width:0;display:flex}
.name a:hover .song{text-decoration:underline}
.clip{min-width:0;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.art{flex:none;width:20px;height:20px;border-radius:3px;background:var(--empty);object-fit:cover}
.art.round{border-radius:50%}
.bar{position:relative;display:inline-block;width:64px;height:6px;border-radius:1px;background:var(--empty)}
.fill,.now{display:block;height:100%;min-width:2px;background-image:${ditherTile(13)};background-size:8px 8px;image-rendering:pixelated;border-radius:1px}
.tick{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--text)}
.pair{display:inline-flex;flex-direction:column;gap:2px;width:48px;flex:none}
.pair .now{height:6px}
.pair .before{display:block;height:4px;min-width:2px;background:var(--axis);border-radius:1px}
.cols{display:inline-flex;align-items:flex-end;gap:1px;height:20px;flex:none}
.col{display:block;width:3px;background-image:${ditherTile(11)};background-size:8px 8px;image-rendering:pixelated}
.col.mark{background-image:${ditherTile(16)}}
.col.empty{background:var(--empty)}
.chart{display:flex;align-items:flex-end;gap:2px;height:96px;width:100%}
.chart .col{flex:1;width:auto;min-width:1px}
.axis{display:flex;justify-content:space-between;color:var(--faint);font-size:13px;margin-top:6px}
.ranked{grid-template-columns:20px minmax(0,1fr) 64px auto}
.compare{grid-template-columns:minmax(0,1fr) 48px auto}
.prose{max-width:60ch;text-wrap:pretty;margin:0 0 16px}
.prose .pair,.prose .bar,.prose .cols{vertical-align:middle;margin:0 4px}
.unchecked{text-decoration:underline dotted;text-underline-offset:4px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
article{margin-bottom:48px}
footer{border-top:1px solid var(--line);padding-top:16px;color:var(--faint);font-size:14px}
`;

const MARK_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${MARK_PATH}"/></svg>`;

function doc(head: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${head}<style>${STYLE}</style></head><body>${body}</body></html>`;
}

function recapPage(snapshot: RecapSnapshot, cardUrl: string): string {
  const r = snapshot.recap;
  const label = r.inProgress ? `${r.label} so far` : r.label;
  const description = snapshot.card.figures.map((f) => `${f.value} ${f.label}`).join(" · ");
  const head = [
    `<title>${esc(label)} · encore</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(r.headline)}">`,
    `<meta property="og:description" content="${esc(`${label}. ${description}`)}">`,
    `<meta property="og:image" content="${esc(cardUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(`${label}: ${r.headline}`)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(r.headline)}">`,
    `<meta name="twitter:description" content="${esc(`${label}. ${description}`)}">`,
    `<meta name="twitter:image" content="${esc(cardUrl)}">`,
  ].join("");
  const meta = [r.compare ? `Compared with ${r.compare.label}` : null].filter(Boolean).join(" · ");
  const body = `<main><header><div class="brand">${MARK_SVG}<span>encore</span></div><p class="muted">${esc(label)}</p><h1>${esc(r.headline)}</h1>${meta ? `<p class="muted">${esc(meta)}</p>` : ""}${
    r.note ? `<p class="muted">${esc(r.note)}</p>` : ""
  }</header>${r.quiet ? `<p class="muted">Almost no listening in this period.</p>` : ""}${r.sections.map((s) => sectionHtml(s, r)).join("")}<footer>Made with encore, a self-hosted listening dashboard.</footer></main>`;
  return doc(head, body);
}

const peakOf = (points: { y: number }[]) => points.reduce((top, p, i) => (p.y > points[top]!.y ? i : top), 0);

function seriesLabel(v: Extract<PublicVisual, { kind: "series" }>): string {
  const peak = v.points[peakOf(v.points)]!;
  return `${v.title}: highest ${plainValue(peak.y, v.unit)}, ${axisLabel(peak.x, v.axis)}`;
}

function inlineVisual(v: PublicVisual): string {
  switch (v.kind) {
    case "pair":
      return `${pair(v.now, v.before, `${v.label}: ${plainValue(v.now, v.unit)} against ${plainValue(v.before, v.unit)}`)}<span class="muted">${esc(change(v.now, v.before))}</span>`;
    case "share":
      return bar(v.share, `${v.label}: ${Math.round(v.share * 100)}%${v.before === null ? "" : `, from ${Math.round(v.before * 100)}%`}`, v.before);
    case "series":
      return columns(
        v.points.map((p) => p.y),
        peakOf(v.points),
        seriesLabel(v),
        24,
      );
    default:
      return "";
  }
}

function itemName(item: Extract<PublicVisual, { kind: "ranked" }>["rows"][number]["item"]): string {
  if (item.kind === "label") return `<span class="clip">${esc(item.name)}</span>`;
  const by = item.kind === "song" || item.kind === "album" ? ` <span class="muted">${esc(item.artist)}</span>` : "";
  const name = `<span class="clip"><span class="song">${esc(item.name)}</span>${by}</span>`;
  const url = item.kind === "song" ? spotifyUrl(item.uri) : null;
  return `${art(item.art, item.kind === "artist")}${url ? `<a href="${esc(url)}" rel="noreferrer noopener" target="_blank">${name}</a>` : name}`;
}

function blockVisual(v: PublicVisual): string {
  switch (v.kind) {
    case "ranked": {
      const max = Math.max(...v.rows.map((r) => r.value), 0) || 1;
      return `<section><h2>${esc(v.title)}</h2><ol class="rows">${v.rows
        .map((r, i) => `<li class="grid ranked"><span class="rank">${i + 1}</span><span class="name">${itemName(r.item)}</span>${bar(r.value / max, plainValue(r.value, v.unit))}<span class="num muted">${esc(plainValue(r.value, v.unit))}</span></li>`)
        .join("")}</ol></section>`;
    }
    case "compare":
      return `<section><h2>${esc(v.title)}</h2><ul class="rows">${v.rows
        .map(
          (r) =>
            `<li class="grid compare"><span class="clip">${esc(r.label)}</span>${pair(r.now, r.before, `${r.label}: ${plainValue(r.now, v.unit)} in ${v.nowLabel}, ${plainValue(r.before, v.unit)} in ${v.beforeLabel}`)}<span class="num"><span>${esc(plainValue(r.now, v.unit))}</span> <span class="muted">${esc(`${v.beforeLabel} ${plainValue(r.before, v.unit)}`)}</span></span></li>`,
        )
        .join("")}</ul></section>`;
    case "series": {
      const max = Math.max(...v.points.map((p) => p.y), 0) || 1;
      const peak = peakOf(v.points);
      return `<section><h2>${esc(v.title)}</h2><span class="chart" role="img" aria-label="${esc(seriesLabel(v))}">${v.points
        .map((p, i) => `<span class="${p.y <= 0 ? "col empty" : i === peak ? "col mark" : "col"}" style="height:${p.y <= 0 ? "2px" : pct(Math.max(0.03, p.y / max))}"></span>`)
        .join("")}</span><p class="axis"><span>${esc(axisLabel(v.points[0]!.x, v.axis))}</span><span>${esc(axisLabel(v.points.at(-1)!.x, v.axis))}</span></p></section>`;
    }
    default:
      return `<p>${inlineVisual(v)}</p>`;
  }
}

function answerPage(snapshot: AnswerSnapshot, cardUrl: string): string {
  const { question, answer, card } = snapshot;
  const title = card.lead || question;
  const head = [
    `<title>${esc(question)} · encore</title>`,
    `<meta name="description" content="${esc(card.lead)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(question)}">`,
    `<meta property="og:image" content="${esc(cardUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(`${question} ${card.lead}`)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(question)}">`,
    `<meta name="twitter:image" content="${esc(cardUrl)}">`,
  ].join("");
  const blocks = answer.blocks
    .map((b) => {
      if (b.type === "visual") return answer.visuals[b.id] ? blockVisual(answer.visuals[b.id]!) : "";
      return `<p class="prose">${b.spans
        .map((s) => {
          if ("visual" in s) return answer.visuals[s.visual] ? inlineVisual(answer.visuals[s.visual]!) : "";
          return s.unchecked ? `<span class="unchecked">${esc(s.text)}<span class="sr"> (not in the data)</span></span>` : esc(s.text);
        })
        .join("")}</p>`;
    })
    .join("");
  const body = `<main><header><div class="brand">${MARK_SVG}<span>encore</span></div><h1>${esc(question)}</h1></header><article>${blocks}${
    answer.basis ? `<p class="muted">Based on: ${esc(answer.basis)}</p>` : ""
  }</article><footer>Made with encore, a self-hosted listening dashboard.</footer></main>`;
  return doc(head, body);
}

/** The share page for one snapshot. `cardUrl` is absolute, for link previews. */
export function sharePage(snapshot: ShareSnapshot, cardUrl: string): string {
  return snapshot.kind === "answer" ? answerPage(snapshot, cardUrl) : recapPage(snapshot, cardUrl);
}

/** The same page for every link that does not open: unknown, revoked or expired. */
export function notFoundPage(): string {
  return doc("<title>Not found · encore</title>", `<main><header><div class="brand">${MARK_SVG}<span>encore</span></div><h1>This page does not exist</h1></header></main>`);
}
