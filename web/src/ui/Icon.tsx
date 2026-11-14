import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export {
  Airplane01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  CompassIcon,
  HourglassIcon,
  Home01Icon,
  Layers01Icon,
  LeftToRightListBulletIcon,
  MoreHorizontalIcon,
  NextIcon,
  Search01Icon,
  Settings01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

export function Icon({ icon, size = 20, className }: { icon: IconSvgElement; size?: 16 | 20; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden className={`shrink-0 ${className ?? ""}`} />;
}
