import { useState } from "react";
import { useLocation } from "wouter";
import { useCorrections } from "../../api/corrections";
import { useSearch } from "../../api/queries";
import { artistPath } from "../../app/paths";
import { fmtHours } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { Button, buttonClass } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { PageHeader, Section } from "../../ui/Page";
import { SearchField } from "../../ui/SearchField";
import { EmptyState } from "../../ui/States";

/** Picks the artist whose plays this one's should count as. */
export function CountAsDialog({ artist, open, onOpenChange }: { artist: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const search = useSearch(q, 8);
  const corrections = useCorrections();
  const [, navigate] = useLocation();
  const matches = (search.data?.artists ?? []).filter((a) => a.artist !== artist);
  const choose = async (canonical: string) => {
    setBusy(canonical);
    const done = await corrections.addAlias(artist, canonical);
    setBusy(null);
    if (!done) return;
    onOpenChange(false);
    navigate(artistPath(canonical));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Count ${artist} as another artist`} description={`Every play of ${artist} will count toward the artist you choose.`} width={440}>
      <div className="flex flex-col gap-2 pb-5">
        <SearchField label="Search artists you played" placeholder="Artist…" value={q} onChange={setQ} fill />
        {q.trim() && search.data && matches.length === 0 ? (
          <EmptyState size="inline" title="No artist you played matches" />
        ) : (
          <ul className="flex flex-col">
            {matches.map((a) => (
              <li key={a.artist}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void choose(a.artist)}
                  className="-mx-2 flex min-h-(--row-h) w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 hover:bg-fill disabled:opacity-60"
                >
                  <Artwork src={a.imageUrl} kind="artist" box={32} />
                  <span className="min-w-0 flex-1 truncate">{a.artist}</span>
                  <span className="shrink-0 text-secondary tabular">{busy === a.artist ? "Moving…" : fmtHours(a.hours)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** The names that count as this artist, each with its undo. Hidden when there are none. */
export function AlsoCounts({ names }: { names: string[] }) {
  const corrections = useCorrections();
  if (names.length === 0) return null;
  return (
    <Section title="Also counts">
      <ul className="flex flex-col">
        {names.map((name) => (
          <li key={name} className="flex min-h-(--row-h) items-center gap-3">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <Button size="sm" variant="ghost" className="-mr-2.5" onClick={() => void corrections.removeAlias(name)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The page of a name that counts as another artist: where its plays went, and the way back. */
export function CountedAs({ name, canonical }: { name: string; canonical: string }) {
  const corrections = useCorrections();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={name} />
      <EmptyState
        size="page"
        title={`${name} counts as ${canonical}`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <AppLink to={artistPath(canonical)} className={buttonClass({ variant: "primary" })}>
              Open {canonical}
            </AppLink>
            <Button onClick={() => void corrections.removeAlias(name)}>Count separately</Button>
          </div>
        }
      />
    </div>
  );
}
