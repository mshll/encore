import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useLocation } from "wouter";
import { AppLink } from "../ui/AppLink";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { DotsThreeIcon, MagnifyingGlassIcon } from "../ui/icons";
import { BACKDROP } from "../ui/surfaces";
import { PHONE_MORE, PHONE_TABS } from "./nav";

const TAB = "press flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-label font-medium";

/** Phone: four listening tabs and More. More opens a sheet with search and every other surface. */
export function PhoneNav({ onSearch }: { onSearch: () => void }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const moreActive = PHONE_MORE.some((s) => s.match(location));
  return (
    <>
      <nav aria-label="Main" className="flex h-(--tabbar-h) bg-shell px-[env(safe-area-inset-left)] hairline-t">
        {PHONE_TABS.map((s) => {
          const active = s.match(location);
          return (
            <AppLink key={s.id} to={s.path} aria-current={active ? "page" : undefined} className={cx(TAB, active ? "text-primary" : "text-tertiary")}>
              <Icon icon={s.icon} size="md" fill={active} />
              <span className="text-center">{s.label}</span>
            </AppLink>
          );
        })}
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={cx(TAB, moreActive ? "text-primary" : "text-tertiary")}>
          <Icon icon={DotsThreeIcon} size="md" />
          <span className="text-center">More</span>
        </button>
      </nav>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={BACKDROP} />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 rounded-t-[14px] bg-overlay pb-[max(16px,env(safe-area-inset-bottom))] shadow-modal outline-none transition-transform duration-300 ease-(--ease-drawer) data-[ending-style]:translate-y-full data-[ending-style]:duration-200 data-[starting-style]:translate-y-full motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[starting-style]:opacity-0">
            <Dialog.Close aria-label="Close" className="mx-auto flex h-11 w-[88px] items-center justify-center">
              <span className="h-[5px] w-9 rounded-full bg-fill-active" />
            </Dialog.Close>
            <Dialog.Title className="sr-only">More</Dialog.Title>
            <div className="flex flex-col gap-2 px-5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSearch();
                }}
                className="flex h-11 items-center gap-3 rounded-md bg-fill px-3 text-secondary"
              >
                <Icon icon={MagnifyingGlassIcon} />
                Search
              </button>
              <ul className="flex flex-col">
                {PHONE_MORE.map((s) => {
                  const active = s.match(location);
                  return (
                    <li key={s.id}>
                      <AppLink
                        to={s.path}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cx("flex h-12 items-center gap-3 rounded-md px-3", active ? "bg-fill text-primary" : "text-primary")}
                      >
                        <Icon icon={s.icon} size="md" fill={active} className="text-secondary" />
                        {s.label}
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
