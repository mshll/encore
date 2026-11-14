import { eq } from "drizzle-orm";
import { overview } from "../../analytics/overview";
import { forgotten, onThisDay } from "../../analytics/recall";
import { search } from "../../analytics/search";
import { topArtists, topTracks } from "../../analytics/top";
import { proposalCounts } from "../../cleanup/proposals";
import { tracks } from "../../db/schema";
import { trackSummary } from "../../ingest/live/watcher";
import { localTime } from "../../plays/localTime";
import { listReleases } from "../../radar/radar";
import { UserFacingError } from "../interactions";
import { customId, type DiscordContext, type DiscordRegistry } from "../registry";
import { label, plain, type ActionRow, type Embed, type Message } from "../types";

const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;
const RANGES = { week: { days: 7, title: "Last 7 days" }, month: { days: 30, title: "Last 30 days" }, year: { days: 365, title: "Last 12 months" }, all: { days: 0, title: "All time" } } as const;
type RangeKey = keyof typeof RANGES;

const rangeOption = {
  type: 3 as const,
  name: "range",
  description: "Time range",
  choices: (Object.keys(RANGES) as RangeKey[]).map((key) => ({ name: RANGES[key].title, value: key })),
};

function rangeOf(ctx: DiscordContext, value: string | number | undefined) {
  const key = (typeof value === "string" && value in RANGES ? value : "month") as RangeKey;
  const { days, title } = RANGES[key];
  if (days === 0) return { range: {}, title };
  const today = localTime(ctx.now(), ctx.config.timezone).day;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { range: { from, to: today }, title };
}

const hours = (h: number) => `${h.toLocaleString("en-US")} h`;
const percent = (r: number | null) => (r === null ? "n/a" : `${Math.round(r * 100)}%`);
const duration = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

type ResolvedTrack = { uri: string; name: string; artist: string; albumArtUrl: string | null };

function queryOf(value: string | number | undefined): string {
  const q = String(value ?? "").trim();
  if (!q || q.length > 200) throw new UserFacingError("Give a song name, up to 200 characters.");
  return q;
}

async function resolveTrack(ctx: DiscordContext, query: string): Promise<ResolvedTrack> {
  const local = search(ctx.db, { q: query, limit: 1 }).songs[0];
  if (local) return { uri: local.uri, name: local.name, artist: local.artist, albumArtUrl: local.albumArtUrl };
  const remote = await ctx.services.player.searchTrack(query);
  if (!remote) throw new UserFacingError("No song matches that.");
  return trackSummary(remote);
}

function trackEmbed(track: ResolvedTrack, author: string): Embed {
  return { author: { name: author }, title: plain(track.name), description: plain(track.artist, 1024), ...(track.albumArtUrl ? { thumbnail: { url: track.albumArtUrl } } : {}) };
}

export function queueButtonRow(items: { uri: string; name: string }[]): ActionRow[] {
  if (items.length === 0) return [];
  return [{ type: 1, components: items.slice(0, 5).map((t) => ({ type: 2, style: 2, label: label(`Queue ${t.name}`), custom_id: customId("queue", t.uri) })) }];
}

export function registerCoreCommands(registry: DiscordRegistry): DiscordRegistry {
  return registry
    .addCommand({
      definition: { name: "now", description: "What is playing" },
      defer: true,
      handle: async ({ ctx }) => {
        const now = await ctx.services.watcher.nowPlaying(ctx.config.watcherIdleMs + 5000);
        if (!now.track) return { content: "Nothing is playing." };
        const status = [now.playing ? "Playing" : "Paused", now.device?.name].filter(Boolean).join(" on ");
        return {
          embeds: [
            {
              author: { name: plain(status) },
              title: plain(now.track.name),
              description: plain(`${now.track.artist} · ${now.track.album}`, 1024),
              ...(now.track.albumArtUrl ? { image: { url: now.track.albumArtUrl } } : {}),
              footer: { text: `${duration(now.progressMs ?? 0)} of ${duration(now.track.durationMs)}` },
            },
          ],
        };
      },
    })
    .addCommand({
      definition: { name: "play", description: "Play a song now", options: [{ type: 3, name: "query", description: "Song name", required: true }] },
      defer: true,
      handle: async ({ ctx, options }) => {
        const track = await resolveTrack(ctx, queryOf(options.query));
        await ctx.services.player.play({ uris: [track.uri] });
        return { embeds: [trackEmbed(track, "Playing")] };
      },
    })
    .addCommand({
      definition: { name: "queue", description: "Add a song to the queue", options: [{ type: 3, name: "query", description: "Song name", required: true }] },
      defer: true,
      handle: async ({ ctx, options }) => {
        const track = await resolveTrack(ctx, queryOf(options.query));
        await ctx.services.player.addToQueue(track.uri);
        return { embeds: [trackEmbed(track, "Queued")] };
      },
    })
    .addCommand({
      definition: { name: "skip", description: "Skip to the next song" },
      defer: true,
      handle: async ({ ctx }) => {
        await ctx.services.player.next();
        return { content: "Skipped." };
      },
    })
    .addCommand({
      definition: { name: "stats", description: "Listening totals", options: [rangeOption] },
      defer: false,
      handle: ({ ctx, options }) => {
        const { range, title } = rangeOf(ctx, options.range);
        const o = overview(ctx.db, { range });
        if (o.plays === 0) return { content: `No plays in ${title.toLowerCase()}.` };
        const fields = [
          { name: "Hours", value: hours(o.hours), inline: true },
          { name: "Listens", value: o.listens.toLocaleString("en-US"), inline: true },
          { name: "Skip rate", value: percent(o.skipRate), inline: true },
          { name: "Songs", value: o.uniqueTracks.toLocaleString("en-US"), inline: true },
          { name: "Artists", value: o.uniqueArtists.toLocaleString("en-US"), inline: true },
        ];
        if (o.topArtist) fields.push({ name: "Top artist", value: plain(`${o.topArtist.artist} · ${hours(o.topArtist.hours)}`, 1024), inline: false });
        if (o.topTrack) fields.push({ name: "Top song", value: plain(`${o.topTrack.name} · ${o.topTrack.artist}`, 1024), inline: false });
        const art = o.topArtist?.imageUrl ?? o.topTrack?.albumArtUrl;
        return { embeds: [{ title, fields, ...(art ? { thumbnail: { url: art } } : {}) }] };
      },
    })
    .addCommand({
      definition: {
        name: "top",
        description: "Top artists or songs",
        options: [
          { type: 3, name: "kind", description: "Artists or songs", choices: [{ name: "Artists", value: "artists" }, { name: "Songs", value: "songs" }] },
          rangeOption,
        ],
      },
      defer: false,
      handle: ({ ctx, options }) => {
        const { range, title } = rangeOf(ctx, options.range);
        const songs = options.kind === "songs";
        const rows = songs
          ? topTracks(ctx.db, { range, limit: 10 }).map((t) => ({ text: `${t.name} · ${t.artist}`, hours: t.hours, art: t.albumArtUrl }))
          : topArtists(ctx.db, { range, limit: 10 }).map((a) => ({ text: a.artist, hours: a.hours, art: a.imageUrl }));
        if (rows.length === 0) return { content: `No plays in ${title.toLowerCase()}.` };
        const description = rows.map((r, i) => `${i + 1}. ${plain(r.text, 150)} · ${hours(r.hours)}`).join("\n");
        return { embeds: [{ title: `Top ${songs ? "songs" : "artists"}, ${title.toLowerCase()}`, description, ...(rows[0]!.art ? { thumbnail: { url: rows[0]!.art } } : {}) }] };
      },
    })
    .addCommand({
      definition: { name: "onthisday", description: "What you played on this day in past years" },
      defer: false,
      handle: ({ ctx }) => {
        const today = localTime(ctx.now(), ctx.config.timezone).day;
        const { years } = onThisDay(ctx.db, { date: today, limit: 3 });
        if (years.length === 0) return { content: "No plays on this day in earlier years." };
        const art = years[0]!.topTracks[0]?.albumArtUrl;
        return {
          embeds: [
            {
              title: `On ${today.slice(5)} in earlier years`,
              fields: years.slice(0, 25).map((y) => ({
                name: `${y.year} · ${hours(y.hours)}`,
                value: y.topTracks.map((t) => plain(`${t.name} · ${t.artist}`, 300)).join("\n") || "No songs",
              })),
              ...(art ? { thumbnail: { url: art } } : {}),
            },
          ],
        };
      },
    })
    .addCommand({
      definition: { name: "forgotten", description: "Favourites you have not played in a while" },
      defer: false,
      handle: ({ ctx }) => forgottenMessage(ctx),
    })
    .addCommand({
      definition: { name: "releases", description: "New releases from artists you play" },
      defer: false,
      handle: ({ ctx }) => {
        const items = listReleases(ctx.db, { status: "new", since: "0000", limit: 10 });
        if (items.length === 0) return { content: "No new releases." };
        return {
          embeds: items.map((r) => ({
            title: plain(r.name),
            url: r.url,
            description: `${plain(r.artist, 200)} · ${r.albumType} · ${r.releaseDate}`,
            ...(r.imageUrl ? { thumbnail: { url: r.imageUrl } } : {}),
          })),
        };
      },
    })
    .addCommand({
      definition: { name: "cleanup", description: "Library cleanup proposals" },
      defer: false,
      handle: ({ ctx }) => {
        const counts = proposalCounts(ctx.db);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const lines = [
          `Saved, never played: ${counts.saved_never_played}`,
          `Saved, usually skipped: ${counts.saved_dislike}`,
          `In playlists, nearly always skipped: ${counts.playlist_skipped}`,
          `Duplicates in playlists: ${counts.playlist_duplicate}`,
        ];
        return {
          embeds: [{ title: total ? `${total} cleanup proposals` : "No cleanup proposals", description: lines.join("\n") }],
          components: [{ type: 1, components: [{ type: 2, style: 5, label: "Review in encore", url: ctx.config.publicBaseUrl }] }],
        };
      },
    })
    .addComponent({
      prefix: "queue",
      defer: true,
      ephemeral: true,
      handle: async ({ ctx, arg }) => {
        if (!TRACK_URI.test(arg)) throw new UserFacingError("This button no longer works.");
        await ctx.services.player.addToQueue(arg);
        const name = ctx.db.select({ name: tracks.name }).from(tracks).where(eq(tracks.uri, arg)).get()?.name;
        return { content: name ? `Queued ${plain(name)}.` : "Queued." };
      },
    });
}

export function forgottenMessage(ctx: DiscordContext, limit = 5): Message {
  const items = forgotten(ctx.db, { days: 90, minListens: 10, limit, asOf: ctx.now() }).items;
  if (items.length === 0) return { content: "No forgotten favourites right now." };
  return {
    embeds: items.map((s) => ({
      title: plain(s.name),
      description: `${plain(s.artist, 200)} · ${s.listens} listens · last played ${s.lastPlayed?.slice(0, 10)}`,
      ...(s.albumArtUrl ? { thumbnail: { url: s.albumArtUrl } } : {}),
    })),
    components: queueButtonRow(items),
  };
}
