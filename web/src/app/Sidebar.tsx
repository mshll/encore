import { useLocation } from "wouter";
import { useOnboarding, useStatus } from "../api/queries";
import { AppLink } from "../ui/AppLink";
import { Lockup } from "../ui/Brand";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { MagnifyingGlassIcon, SignOutIcon } from "../ui/icons";
import { useSignOut } from "../lib/signOut";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { byPlace, type Surface } from "./nav";

const ROW = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-body-sm transition-colors duration-150";

function NavRow({ item, location }: { item: Surface; location: string }) {
  const active = item.match(location);
  return (
    <AppLink
      to={item.path}
      aria-current={active ? "page" : undefined}
      className={cx(ROW, active ? "bg-fill text-primary" : "text-secondary hover:bg-fill hover:text-primary")}
    >
      <Icon icon={item.icon} fill={active} className={active ? "text-primary" : "text-tertiary"} />
      <span className="truncate">{item.label}</span>
    </AppLink>
  );
}

function SignOutRow() {
  const signOut = useSignOut();
  return (
    <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()} className={cx(ROW, "text-secondary hover:bg-fill hover:text-primary disabled:opacity-60")}>
      <Icon icon={SignOutIcon} className="text-tertiary" />
      <span className="truncate">{signOut.isPending ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

function SpotifyStatus() {
  const q = useStatus();
  if (!q.data) return null;
  const s = q.data.spotify;
  const problem = !s.connected ? "Spotify not connected" : s.paused ? "Spotify calls paused" : null;
  if (!problem) return null;
  return (
    <AppLink to="/settings/spotify" className={cx(ROW, "text-warning hover:bg-fill")}>
      <span aria-hidden className="mx-1 size-1.5 rounded-full bg-warning" />
      {problem}
    </AppLink>
  );
}

function NavGroup({ label, items, location }: { label?: string; items: Surface[]; location: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <h2 className="px-2 text-caption text-secondary">{label}</h2>}
      <ul className="flex flex-col gap-px">
        {items.map((s) => (
          <li key={s.id}>
            <NavRow item={s} location={location} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Setup leaves the sidebar once every step is done, unless it is open; Settings and the palette still reach it. */
function useSecondary(location: string) {
  const complete = useOnboarding().data?.complete;
  return byPlace("secondary").filter((s) => s.id !== "setup" || complete === false || s.match(location));
}

/** Linear-style: Listening and Spotify, each under its name, then Setup until it is done; Settings at the foot. */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const [location] = useLocation();
  const secondary = useSecondary(location);
  return (
    <aside className="flex h-full w-(--sidebar-w) flex-col gap-4 px-3 pt-3 pb-2">
      <div className="flex h-8 items-center px-2">
        <AppLink to="/" aria-label="encore, home" className="rounded-sm">
          <Lockup />
        </AppLink>
      </div>
      <button type="button" onClick={onSearch} className={cx(ROW, "bg-fill text-secondary hover:bg-fill-hover hover:text-primary")}>
        <Icon icon={MagnifyingGlassIcon} className="text-tertiary" />
        <span className="flex-1 text-left">Search</span>
        <span className="flex gap-0.5">
          <Kbd>{MOD_KEY}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <nav aria-label="Main" data-crop className="flex flex-1 flex-col gap-5 overflow-y-auto">
        <NavGroup label="Listening" items={byPlace("listening")} location={location} />
        <NavGroup label="Spotify" items={byPlace("spotify")} location={location} />
        {secondary.length > 0 && <NavGroup items={secondary} location={location} />}
      </nav>
      <div className="flex flex-col gap-px">
        <SpotifyStatus />
        {byPlace("foot").map((s) => (
          <NavRow key={s.id} item={s} location={location} />
        ))}
        <SignOutRow />
      </div>
    </aside>
  );
}
