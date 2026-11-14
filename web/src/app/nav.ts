import type { IconSvgElement } from "@hugeicons/react";
import {
  Airplane01Icon,
  Clock01Icon,
  CompassIcon,
  Home01Icon,
  HourglassIcon,
  Layers01Icon,
  LeftToRightListBulletIcon,
  NextIcon,
  Settings01Icon,
} from "../ui/Icon";

export type NavItem = { path: string; label: string; icon: IconSvgElement; match: (location: string) => boolean };

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
  { path: "/explore", label: "Explore", icon: CompassIcon, match: prefix("/explore", "/artist", "/album", "/song") },
];

export const SETTINGS: NavItem = { path: "/settings", label: "Settings", icon: Settings01Icon, match: exact("/settings") };

export const TAB_PATHS = ["/", "/skips", "/history", "/explore"];
