import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Airplane01Icon from "@hugeicons/core-free-icons/Airplane01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import BubbleChatQuestionIcon from "@hugeicons/core-free-icons/BubbleChatQuestionIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CompassIcon from "@hugeicons/core-free-icons/CompassIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import GiftIcon from "@hugeicons/core-free-icons/GiftIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import HourglassIcon from "@hugeicons/core-free-icons/HourglassIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import MusicNoteSquare01Icon from "@hugeicons/core-free-icons/MusicNoteSquare01Icon";
import NewReleasesIcon from "@hugeicons/core-free-icons/NewReleasesIcon";
import NextIcon from "@hugeicons/core-free-icons/NextIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import PlayListIcon from "@hugeicons/core-free-icons/PlayListIcon";
import Radio01Icon from "@hugeicons/core-free-icons/Radio01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";

export {
  Airplane01Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  BubbleChatQuestionIcon,
  Cancel01Icon,
  Clock01Icon,
  CompassIcon,
  Delete02Icon,
  GiftIcon,
  Home01Icon,
  HourglassIcon,
  Layers01Icon,
  LeftToRightListBulletIcon,
  MoreHorizontalIcon,
  MusicNoteSquare01Icon,
  NewReleasesIcon,
  NextIcon,
  PauseIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  PlayListIcon,
  Radio01Icon,
  Search01Icon,
  Settings01Icon,
  Tick02Icon,
};

export function Icon({ icon, size = 20, className }: { icon: IconSvgElement; size?: 16 | 20; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden className={`shrink-0 ${className ?? ""}`} />;
}
