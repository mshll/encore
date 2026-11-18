import {
  BroomIcon,
  ChartBarIcon,
  GearSixIcon,
  HouseIcon,
  ListBulletsIcon,
  NewspaperIcon,
  PlaylistIcon,
  RocketLaunchIcon,
  VinylRecordIcon,
  type IconGlyph,
} from "../ui/icons";

/** Where a surface sits in the sidebar: a group, its foot, or nowhere (Setup once done is reached from Settings). */
export type NavPlace = "listening" | "spotify" | "secondary" | "foot";

export type Surface = {
  id: string;
  path: string;
  label: string;
  icon: IconGlyph;
  place: NavPlace;
  /** Second key of the `G` then key shortcut. */
  key?: string;
  match: (location: string) => boolean;
};

const exact = (path: string) => (location: string) => location === path;
const under = (path: string) => (location: string) => location === path || location.startsWith(`${path}/`);

/** The new information architecture. DESIGN.md, section 1, describes what each surface answers. */
export const SURFACES: Surface[] = [
  { id: "home", path: "/", label: "Home", icon: HouseIcon, place: "listening", key: "h", match: exact("/") },
  { id: "plays", path: "/plays", label: "Plays", icon: ListBulletsIcon, place: "listening", key: "p", match: under("/plays") },
  { id: "music", path: "/music", label: "Music", icon: VinylRecordIcon, place: "listening", key: "m", match: under("/music") },
  { id: "patterns", path: "/patterns", label: "Patterns", icon: ChartBarIcon, place: "listening", key: "t", match: under("/patterns") },
  { id: "recaps", path: "/recaps", label: "Recaps", icon: NewspaperIcon, place: "listening", key: "r", match: under("/recaps") },
  { id: "playlists", path: "/playlists", label: "Playlists", icon: PlaylistIcon, place: "spotify", key: "y", match: under("/playlists") },
  { id: "library", path: "/library", label: "Library", icon: BroomIcon, place: "spotify", key: "l", match: under("/library") },
  { id: "setup", path: "/setup", label: "Setup", icon: RocketLaunchIcon, place: "secondary", match: under("/setup") },
  { id: "settings", path: "/settings", label: "Settings", icon: GearSixIcon, place: "foot", key: ",", match: under("/settings") },
];

export const byPlace = (place: NavPlace) => SURFACES.filter((s) => s.place === place);

const PHONE_TAB_IDS = ["home", "playlists", "music"];

/**
 * Phone tab bar: Home, Music and Playlists, the three a phone is picked up for (glance at the week, play something, look
 * up an artist); everything else, in sidebar order, sits in the More sheet. Plays is a log to search, more at home on a desk.
 */
export const PHONE_TABS = SURFACES.filter((s) => PHONE_TAB_IDS.includes(s.id));
export const PHONE_MORE = SURFACES.filter((s) => !PHONE_TAB_IDS.includes(s.id));

/** A tab under a surface. `owns` holds the path prefixes of the detail pages that sit under the tab in the breadcrumb trail. */
export type SurfaceTab = { path: string; label: string; owns?: string[] };

export const MUSIC_TABS: SurfaceTab[] = [
  { path: "/music/artists", label: "Artists", owns: ["/music/artist/"] },
  { path: "/music/albums", label: "Albums", owns: ["/music/album/"] },
  { path: "/music/songs", label: "Songs", owns: ["/music/song/"] },
  { path: "/music/forgotten", label: "Forgotten" },
  { path: "/music/podcasts", label: "Podcasts" },
];

export const PATTERN_TABS: SurfaceTab[] = [
  { path: "/patterns/when", label: "When" },
  { path: "/patterns/eras", label: "Eras" },
  { path: "/patterns/taste", label: "Taste" },
  { path: "/patterns/discovery", label: "Discovery" },
  { path: "/patterns/records", label: "Records" },
  { path: "/patterns/skips", label: "Skips" },
  { path: "/patterns/places", label: "Places" },
];

export const LIBRARY_TABS: SurfaceTab[] = [
  { path: "/library", label: "Overview" },
  { path: "/library/plans", label: "Plans", owns: ["/library/plans/", "/library/claude/"] },
  { path: "/library/instructions", label: "Instructions" },
];

export const SETTINGS_TABS: SurfaceTab[] = [
  { path: "/settings/general", label: "General" },
  { path: "/settings/spotify", label: "Spotify" },
  { path: "/settings/ai", label: "AI" },
  { path: "/settings/integrations", label: "Integrations" },
  { path: "/settings/jobs", label: "Jobs" },
  { path: "/settings/data", label: "Data" },
  { path: "/settings/alerts", label: "Alerts" },
  { path: "/settings/account", label: "Account" },
];

const TABS: Record<string, SurfaceTab[]> = { music: MUSIC_TABS, patterns: PATTERN_TABS, library: LIBRARY_TABS, settings: SETTINGS_TABS };

export type Crumb = { label: string; path: string };

/**
 * The levels above a page: its surface, then the tab that owns it. Null for a top-level page and for a tab of one,
 * where the sidebar and the tab strip already say where you are.
 */
export function trailFor(location: string): Crumb[] | null {
  const surface = SURFACES.find((s) => s.path !== "/" && s.match(location));
  if (!surface || location === surface.path) return null;
  const tabs = TABS[surface.id] ?? [];
  if (tabs.some((t) => t.path === location)) return null;
  const tab = tabs.find((t) => t.owns?.some((prefix) => location.startsWith(prefix)));
  return [{ label: surface.label, path: surface.path }, ...(tab ? [{ label: tab.label, path: tab.path }] : [])];
}
