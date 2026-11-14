import type { IconSvgElement } from "@hugeicons/react";
import {
  Airplane01Icon,
  BubbleChatQuestionIcon,
  Clock01Icon,
  CompassIcon,
  Delete02Icon,
  GiftIcon,
  Home01Icon,
  HourglassIcon,
  Layers01Icon,
  LeftToRightListBulletIcon,
  MusicNoteSquare01Icon,
  NewReleasesIcon,
  NextIcon,
  Radio01Icon,
  Settings01Icon,
} from "../ui/Icon";

export type NavItem = { path: string; label: string; icon: IconSvgElement; match: (location: string) => boolean; group?: string };

const exact = (path: string) => (location: string) => location === path;
const prefix =
  (...paths: string[]) =>
  (location: string) =>
    paths.some((p) => location === p || location.startsWith(`${p}/`));

export const NAV: NavItem[] = [
  { path: "/", label: "Overview", icon: Home01Icon, match: exact("/") },
  { path: "/eras", label: "Eras", icon: Layers01Icon, match: exact("/eras") },
  { path: "/clock", label: "Clock", icon: Clock01Icon, match: exact("/clock") },
  { path: "/skips", label: "Skips", icon: NextIcon, match: exact("/skips") },
  { path: "/forgotten", label: "Forgotten", icon: HourglassIcon, match: exact("/forgotten") },
  { path: "/trips", label: "Trips", icon: Airplane01Icon, match: exact("/trips") },
  { path: "/history", label: "History", icon: LeftToRightListBulletIcon, match: exact("/history") },
  { path: "/explore", label: "Explore", icon: CompassIcon, match: prefix("/explore", "/artist", "/album", "/song"), group: "Play" },
  { path: "/sets", label: "Sets", icon: MusicNoteSquare01Icon, match: prefix("/sets"), group: "Play" },
  { path: "/picks", label: "Picks", icon: GiftIcon, match: exact("/picks"), group: "Play" },
  { path: "/ask", label: "Ask", icon: BubbleChatQuestionIcon, match: exact("/ask"), group: "Play" },
  { path: "/session", label: "Session", icon: Radio01Icon, match: exact("/session"), group: "Play" },
  { path: "/releases", label: "Releases", icon: NewReleasesIcon, match: exact("/releases"), group: "Play" },
  { path: "/cleanup", label: "Cleanup", icon: Delete02Icon, match: exact("/cleanup"), group: "Library" },
];

export const NAV_GROUPS = [...new Set(NAV.map((n) => n.group))].map((group) => ({ group, items: NAV.filter((n) => n.group === group) }));

export const SETTINGS: NavItem = { path: "/settings", label: "Settings", icon: Settings01Icon, match: exact("/settings") };

export const TAB_PATHS = ["/", "/skips", "/history", "/explore"];
