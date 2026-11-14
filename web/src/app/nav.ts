import type { IconGlyph } from "../ui/Icon";
import {
  BroomIcon,
  ChartBarIcon,
  ChatCircleTextIcon,
  GearSixIcon,
  HouseIcon,
  ListBulletsIcon,
  NewspaperIcon,
  PlaylistIcon,
  RocketLaunchIcon,
  SparkleIcon,
  VinylRecordIcon,
} from "../ui/icons";

/** Where a surface sits in navigation: a sidebar group (the third sits under More on a phone), or the foot of the sidebar. */
export type NavPlace = "listening" | "play" | "secondary" | "foot";

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
  { id: "overview", path: "/", label: "Overview", icon: HouseIcon, place: "listening", key: "o", match: exact("/") },
  { id: "plays", path: "/plays", label: "Plays", icon: ListBulletsIcon, place: "listening", key: "p", match: under("/plays") },
  { id: "music", path: "/music", label: "Music", icon: VinylRecordIcon, place: "listening", key: "m", match: under("/music") },
  { id: "patterns", path: "/patterns", label: "Patterns", icon: ChartBarIcon, place: "listening", key: "t", match: under("/patterns") },
  { id: "for-you", path: "/for-you", label: "For you", icon: SparkleIcon, place: "play", key: "f", match: under("/for-you") },
  { id: "sets", path: "/sets", label: "Sets", icon: PlaylistIcon, place: "play", key: "s", match: under("/sets") },
  { id: "ask", path: "/ask", label: "Ask", icon: ChatCircleTextIcon, place: "play", key: "a", match: under("/ask") },
  { id: "recaps", path: "/recaps", label: "Recaps", icon: NewspaperIcon, place: "secondary", key: "r", match: under("/recaps") },
  { id: "library", path: "/library", label: "Library", icon: BroomIcon, place: "secondary", key: "l", match: under("/library") },
  { id: "setup", path: "/setup", label: "Setup", icon: RocketLaunchIcon, place: "secondary", match: under("/setup") },
  { id: "settings", path: "/settings", label: "Settings", icon: GearSixIcon, place: "foot", key: ",", match: under("/settings") },
];

export const byPlace = (place: NavPlace) => SURFACES.filter((s) => s.place === place);

/** Phone tab bar: the listening surfaces; everything else sits in the More sheet. */
export const PHONE_TABS = byPlace("listening");
export const PHONE_MORE = SURFACES.filter((s) => s.place !== "listening");

export const MUSIC_TABS = [
  { path: "/music/artists", label: "Artists" },
  { path: "/music/albums", label: "Albums" },
  { path: "/music/songs", label: "Songs" },
  { path: "/music/forgotten", label: "Forgotten" },
];

export const PATTERN_TABS = [
  { path: "/patterns/when", label: "When" },
  { path: "/patterns/eras", label: "Eras" },
  { path: "/patterns/taste", label: "Taste" },
  { path: "/patterns/skips", label: "Skips" },
  { path: "/patterns/places", label: "Places" },
];

export const FOR_YOU_TABS = [
  { path: "/for-you/picks", label: "Picks" },
  { path: "/for-you/releases", label: "Releases" },
];

export const SETTINGS_TABS = [
  { path: "/settings/general", label: "General" },
  { path: "/settings/spotify", label: "Spotify" },
  { path: "/settings/claude", label: "Claude" },
  { path: "/settings/integrations", label: "Integrations" },
  { path: "/settings/jobs", label: "Jobs" },
  { path: "/settings/account", label: "Account" },
];
