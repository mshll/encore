import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation, useSearchParams } from "wouter";
import { get } from "../../api/client";
import { useLifetime, useLiving, usePicks, useRecapPlaylists, useSets } from "../../api/queries";
import type { LivingListItem, SavedRecapPlaylist, SetDetail, SetSummary } from "../../api/types";
import { recapPath } from "../../app/paths";
import { useChat } from "../../chat/state";
import { useAi } from "../../lib/ai";
import { fmtAgo } from "../../lib/format";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { buttonClass, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Icon } from "../../ui/Icon";
import { CaretDownIcon, ChatCircleTextIcon, ListBulletsIcon, NewspaperIcon, PlayIcon, PlaylistIcon, PlusIcon, WaveformIcon } from "../../ui/icons";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../../ui/Menu";
import { Page, PageHeader, Section, dimWhile } from "../../ui/Page";
import { TabList, TabsRoot } from "../../ui/Segmented";
import { Skeleton } from "../../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../../ui/States";
import { PickPreviews } from "../Picks";
import { BUILTIN_FILL, ruleSummary } from "./rules";
import { freshLine, type Fresh, gateNotice, newsOf, playable, playlistPath, setPlaylistPath, songs, useNews, usePlayPlaylist } from "./shared";

type Filter = "all" | "made" | "sets" | "rules" | "recaps";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "made", label: "Made for you" },
  { value: "sets", label: "Sets" },
  { value: "rules", label: "Rules" },
  { value: "recaps", label: "From recaps" },
];
const isFilter = (v: string | null): v is Filter => FILTERS.some((f) => f.value === v);

type SetItem = SetSummary & { tracks: number };

/** One playlist, the same shape for every kind: cover, name, how it fills, one fresh line, Play. The row opens its page. */
function PlaylistRow({ to, cover, name, fill, fresh, onPlay, children }: { to: string; cover: string | null; name: string; fill: string; fresh: Fresh; onPlay?: () => void; children?: ReactNode }) {
  return (
    <li className="flex flex-col">
      <div className="group relative -mx-2 flex items-center gap-4 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-fill">
        <Artwork src={cover} kind="playlist" box={64} className="phone:size-14" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <AppLink to={to} title={name} className="truncate font-medium text-primary outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:shadow-[0_0_0_1.5px_var(--focus-ring)]">
            {name}
          </AppLink>
          <span title={fill} className="line-clamp-2 text-secondary md:truncate">
            {fill}
          </span>
          <span className={cx("truncate text-caption tabular", fresh.problem ? "text-danger" : fresh.news ? "text-primary" : "text-secondary")}>{fresh.text}</span>
        </span>
        {onPlay && <IconButton icon={PlayIcon} label={`Play ${name}`} variant="secondary" className="relative shrink-0 rounded-full" onClick={onPlay} />}
      </div>
      {children}
    </li>
  );
}

function LivingRow({ playlist, news, lead }: { playlist: LivingListItem; news: string | null; lead?: ReactNode }) {
  const play = usePlayPlaylist();
  return (
    <PlaylistRow
      to={playlistPath(playlist.kind)}
      cover={playlist.coverUrl}
      name={playlist.name}
      fill={playlist.builtin ? BUILTIN_FILL[playlist.kind as keyof typeof BUILTIN_FILL] : ruleSummary(playlist.rule)}
      fresh={freshLine(playlist, news, true)}
      onPlay={playable(playlist) ? () => void play(playlist) : undefined}
    >
      {lead}
    </PlaylistRow>
  );
}

/** This week's picks with their reasons, under the Weekly picks row, when there are some. */
function PicksLead() {
  const q = usePicks();
  const picks = q.data?.picks.filter((p) => p.state !== "never").slice(0, 3) ?? [];
  if (picks.length === 0) return null;
  return (
    <div className="pt-1 pb-3 md:pl-20">
      <PickPreviews picks={picks} />
    </div>
  );
}

function setFresh(set: SetItem): Fresh {
  if (set.version === 0) return { text: "Waiting for your answer", problem: false, news: true };
  if (set.playlist?.outdated) return { text: "Spotify did not take the last change", problem: true, news: false };
  if (set.playlist) return { text: `Updated ${fmtAgo(set.updatedAt)} · in your Spotify`, problem: false, news: false };
  return { text: `${songs(set.tracks)}, not in Spotify`, problem: false, news: false };
}

/** A set plays from its Spotify playlist when it is there and current, otherwise as its songs. */
function usePlaySet() {
  const playback = usePlayback();
  const queryClient = useQueryClient();
  return async (set: SetSummary) => {
    if (set.playlist && !set.playlist.outdated) return void (await playback.playContext(`spotify:playlist:${set.playlist.id}`));
    const detail = await queryClient.fetchQuery({ queryKey: ["sets", set.id], queryFn: () => get<SetDetail>(`/api/sets/${set.id}`) });
    if (detail.items.length) await playback.play(detail.items.map((i) => i.uri));
  };
}

function SetRow({ set }: { set: SetItem }) {
  const play = usePlaySet();
  return (
    <PlaylistRow
      to={setPlaylistPath(set.id)}
      cover={set.coverUrl}
      name={set.title}
      fill="Made from a prompt"
      fresh={setFresh(set)}
      onPlay={set.tracks > 0 ? () => void play(set) : undefined}
    />
  );
}

const spotifyPlaylistUri = (url: string) => {
  const id = url.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/)?.[1];
  return id ? `spotify:playlist:${id}` : null;
};

function RecapRow({ playlist }: { playlist: SavedRecapPlaylist }) {
  const playback = usePlayback();
  const uri = spotifyPlaylistUri(playlist.url);
  return (
    <PlaylistRow
      to={recapPath(playlist.kind, playlist.key)}
      cover={playlist.coverUrl}
      name={playlist.label}
      fill={playlist.source === "living" ? `Kept when ${playlist.label} ended` : `Saved from its recap`}
      fresh={{ text: `${songs(playlist.songs)} · in your Spotify`, problem: false, news: false }}
      onPlay={uri ? () => void playback.playContext(uri) : undefined}
    />
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <Skeleton className="size-16 shrink-0 rounded-md phone:size-14" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NewPlaylist() {
  const ai = useAi();
  const chat = useChat();
  const [, navigate] = useLocation();
  if (!ai.configured)
    return (
      <AppLink to="/playlists/new" className={buttonClass({ variant: "primary" })}>
        <Icon icon={PlusIcon} size="sm" />
        New playlist
      </AppLink>
    );
  return (
    <MenuRoot>
      <MenuTrigger className={buttonClass({ variant: "primary" })}>
        <Icon icon={PlusIcon} size="sm" />
        New playlist
        <Icon icon={CaretDownIcon} size="sm" className="opacity-70" />
      </MenuTrigger>
      <MenuPopup>
        <MenuItem icon={ChatCircleTextIcon} hint="Make a set" onClick={() => chat.show({ thread: null, mode: "set" })}>
          Describe it
        </MenuItem>
        <MenuItem icon={ListBulletsIcon} onClick={() => navigate("/playlists/new")}>
          Build from rules
        </MenuItem>
      </MenuPopup>
    </MenuRoot>
  );
}

function Group({ title, show, children }: { title: string; show: boolean; children: ReactNode }) {
  if (!show) return <ul className="flex flex-col">{children}</ul>;
  return (
    <Section title={title}>
      <ul className="flex flex-col">{children}</ul>
    </Section>
  );
}

/**
 * Playlists: every playlist encore makes, in one list. The built-ins (Made for you), the owner's rules, sets made from
 * a prompt and period playlists saved from recaps, each row the same shape. Filters narrow it to one kind.
 */
export function Playlists() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("show");
  const filter: Filter = isFilter(asked) ? asked : "all";
  const setFilter = (f: Filter) => setParams(f === "all" ? {} : { show: f }, { replace: true });
  const ai = useAi();
  const chat = useChat();
  const living = useLiving();
  const sets = useSets();
  const recaps = useRecapPlaylists();
  const lifetime = useLifetime();
  const news = useNews();
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;

  const header = <PageHeader title="Playlists" actions={!firstUse && <NewPlaylist />} />;
  if (firstUse)
    return (
      <Page>
        {header}
        <FirstUseState icon={WaveformIcon} description="encore makes playlists from what you play. Import your history or connect Spotify first." />
      </Page>
    );

  const failed = [living, sets, recaps].find((q) => q.isError);
  const loading = !living.data || !sets.data || !recaps.data;
  const builtins = living.data?.items.filter((p) => p.builtin && (ai.configured || p.kind !== "picks")) ?? [];
  const rules = living.data?.items.filter((p) => !p.builtin) ?? [];
  const setItems = sets.data?.items ?? [];
  const recapItems = recaps.data?.items ?? [];
  const all = filter === "all";
  const filters = FILTERS.filter((f) => f.value !== "sets" || ai.configured || setItems.length > 0);

  const body = () => {
    if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
    if (loading) return <ListSkeleton />;
    const madeRows = builtins.map((p) => <LivingRow key={p.kind} playlist={p} news={newsOf(news, p.kind)} lead={p.kind === "picks" ? <PicksLead /> : undefined} />);
    const ruleRows = rules.map((p) => <LivingRow key={p.kind} playlist={p} news={null} />);
    const setRows = setItems.map((s) => <SetRow key={s.id} set={s} />);
    const recapRows = recapItems.map((p) => <RecapRow key={`${p.kind}:${p.key}`} playlist={p} />);
    if (filter === "rules" && rules.length === 0)
      return (
        <EmptyState
          icon={ListBulletsIcon}
          title="No rule playlists yet"
          description="Pick where the songs come from, filter and sort them, and encore keeps the playlist filled."
          action={
            <AppLink to="/playlists/new" className={buttonClass()}>
              Build from rules
            </AppLink>
          }
        />
      );
    if (filter === "sets" && setItems.length === 0)
      return <EmptyState icon={PlaylistIcon} title="No sets yet" description="Describe a playlist and get one built from your history and songs new to you." action={<NewSetButton onClick={() => chat.show({ thread: null, mode: "set" })} />} />;
    if (filter === "recaps" && recapItems.length === 0)
      return (
        <EmptyState
          icon={NewspaperIcon}
          title="No playlists from recaps yet"
          description="Save a week, month or year’s songs from its recap."
          action={
            <AppLink to="/recaps" className={buttonClass()}>
              Open Recaps
            </AppLink>
          }
        />
      );
    return (
      <div className={cx("flex flex-col gap-10 md:gap-12", dimWhile(living.isFetching && !living.isLoading))}>
        {(all || filter === "made") && (
          <Group title="Made for you" show={all}>
            {madeRows}
          </Group>
        )}
        {(all || filter === "rules") && rules.length > 0 && (
          <Group title="Your rules" show={all}>
            {ruleRows}
          </Group>
        )}
        {(all || filter === "sets") && setItems.length > 0 && (
          <Group title="Sets" show={all}>
            {setRows}
          </Group>
        )}
        {(all || filter === "recaps") && recapItems.length > 0 && (
          <Group title="From your recaps" show={all}>
            {recapRows}
          </Group>
        )}
      </div>
    );
  };

  return (
    <Page>
      {header}
      <div className="flex flex-col gap-6">
        <TabsRoot value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabList label="Show" options={filters} className="phone:-mx-(--gutter) phone:px-(--gutter)" />
        </TabsRoot>
        {living.data && gateNotice(living.data.spotify)}
        {body()}
      </div>
    </Page>
  );
}

function NewSetButton({ onClick }: { onClick: () => void }) {
  const ai = useAi();
  if (!ai.configured) return null;
  return (
    <button type="button" onClick={onClick} className={buttonClass()}>
      Describe it
    </button>
  );
}

