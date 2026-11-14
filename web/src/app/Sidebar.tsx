import { Menu } from "@base-ui/react/menu";
import { useLocation } from "wouter";
import { useStatus } from "../api/queries";
import { AppLink } from "../ui/AppLink";
import { Lockup } from "../ui/Brand";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { DotsThreeIcon, MagnifyingGlassIcon } from "../ui/icons";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { MENU_ITEM, POPUP } from "../ui/surfaces";
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

/** Linear-style: a short primary list in two quiet groups, the rest under More, Settings at the foot. */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const [location, navigate] = useLocation();
  const more = byPlace("more");
  const activeMore = more.find((m) => m.match(location));
  return (
    <aside className="flex h-full w-(--sidebar-w) flex-col gap-4 px-3 pt-3 pb-2">
      <div className="flex h-8 items-center px-2">
        <AppLink to="/" aria-label="encore, overview" className="rounded-sm">
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
        <ul className="flex flex-col gap-px">
          {byPlace("listening").map((s) => (
            <li key={s.id}>
              <NavRow item={s} location={location} />
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-px">
          {byPlace("play").map((s) => (
            <li key={s.id}>
              <NavRow item={s} location={location} />
            </li>
          ))}
          {activeMore && (
            <li>
              <NavRow item={activeMore} location={location} />
            </li>
          )}
          <li>
            <Menu.Root>
              <Menu.Trigger className={cx(ROW, "text-secondary hover:bg-fill hover:text-primary data-[popup-open]:bg-fill")}>
                <Icon icon={DotsThreeIcon} className="text-tertiary" />
                More
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="right" align="start" sideOffset={8} className="z-50">
                  <Menu.Popup className={cx(POPUP, "min-w-48 p-1")}>
                    {more.map((m) => (
                      <Menu.Item key={m.id} className={MENU_ITEM} onClick={() => navigate(m.path)}>
                        <Icon icon={m.icon} className="text-secondary" />
                        {m.label}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </li>
        </ul>
      </nav>
      <div className="flex flex-col gap-px">
        <SpotifyStatus />
        {byPlace("foot").map((s) => (
          <NavRow key={s.id} item={s} location={location} />
        ))}
      </div>
    </aside>
  );
}
