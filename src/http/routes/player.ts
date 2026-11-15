import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import { jsonBody, parse } from "../errors";

const trackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/, "expected a Spotify track URI");
const deviceId = z.string().min(1).max(100).optional();

const playBody = z
  .object({
    contextUri: z.string().regex(/^spotify:(album|playlist|artist):[A-Za-z0-9]{22}$/, "expected an album, playlist or artist URI").optional(),
    uris: z.array(trackUri).min(1).max(100).optional(),
    offset: z.union([z.object({ position: z.number().int().min(0) }).strict(), z.object({ uri: trackUri }).strict()]).optional(),
    deviceId,
  })
  .strict()
  .refine((b) => !(b.contextUri && b.uris), { message: "send contextUri or uris, not both", path: ["uris"] });

const optionalBody = async (c: Context<Env>) => (c.req.header("content-type")?.includes("json") ? jsonBody(c) : {});

export const playerRoutes = new Hono<Env>()
  .get("/now", async (c) => {
    const { services, settings } = c.var.deps;
    return c.json(await services.watcher.nowPlaying(settings.get().watcherIdleMs + 5000));
  })
  .get("/devices", async (c) => {
    const devices = await c.var.deps.services.player.devices();
    return c.json({ devices: devices.map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted, volume: d.volume_percent })) });
  })
  .get("/queue", async (c) => {
    const queue = await c.var.deps.services.player.queue();
    const view = (t: { uri: string; name: string; artists?: { name: string }[]; album?: { images?: { url: string }[] } }) => ({
      uri: t.uri,
      name: t.name,
      artist: t.artists?.map((a) => a.name).join(", ") ?? null,
      albumArtUrl: t.album?.images?.[0]?.url ?? null,
    });
    return c.json({ current: queue.currently_playing && view(queue.currently_playing), queue: queue.queue.map(view) });
  })
  .post("/play", async (c) => {
    const { player, watcher } = c.var.deps.services;
    const body = parse(playBody, await optionalBody(c));
    await player.play(body);
    watcher.applied(body.contextUri || body.uris ? {} : { playing: true });
    return c.json({ ok: true });
  })
  .post("/pause", async (c) => {
    const body = parse(z.object({ deviceId }).strict(), await optionalBody(c));
    await c.var.deps.services.player.pause(body.deviceId);
    c.var.deps.services.watcher.applied({ playing: false });
    return c.json({ ok: true });
  })
  .post("/next", async (c) => {
    const body = parse(z.object({ deviceId }).strict(), await optionalBody(c));
    await c.var.deps.services.player.next(body.deviceId);
    c.var.deps.services.watcher.applied();
    return c.json({ ok: true });
  })
  .post("/queue", async (c) => {
    const body = parse(z.object({ uri: trackUri, deviceId }).strict(), await jsonBody(c));
    await c.var.deps.services.player.addToQueue(body.uri, body.deviceId);
    return c.json({ ok: true });
  })
  .post("/shuffle", async (c) => {
    const body = parse(z.object({ state: z.boolean(), deviceId }).strict(), await jsonBody(c));
    await c.var.deps.services.player.shuffle(body.state, body.deviceId);
    c.var.deps.services.watcher.applied({ shuffle: body.state });
    return c.json({ ok: true });
  })
  .post("/transfer", async (c) => {
    const body = parse(z.object({ deviceId: z.string().min(1).max(100), play: z.boolean().default(false) }).strict(), await jsonBody(c));
    await c.var.deps.services.player.transfer(body.deviceId, body.play);
    c.var.deps.services.watcher.applied();
    return c.json({ ok: true });
  });
