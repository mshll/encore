import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import { useSession } from "../api/queries";
import { ErrorState } from "../ui/States";
import { Placeholder } from "../surfaces/Placeholder";
import { RangePicker } from "../ui/RangePicker";
import { PATTERN_TABS, SETTINGS_TABS } from "./nav";
import { paramValue } from "./paths";
import { Shell } from "./Shell";

const Overview = lazy(() => import("../surfaces/Overview").then((m) => ({ default: m.Overview })));
const Plays = lazy(() => import("../surfaces/Plays").then((m) => ({ default: m.Plays })));
const When = lazy(() => import("../surfaces/When").then((m) => ({ default: m.When })));
const Music = lazy(() => import("../surfaces/Music").then((m) => ({ default: m.Music })));
const ArtistPage = lazy(() => import("../surfaces/entity/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const AlbumPage = lazy(() => import("../surfaces/entity/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const SongPage = lazy(() => import("../surfaces/entity/SongPage").then((m) => ({ default: m.SongPage })));
const Picks = lazy(() => import("../surfaces/Picks").then((m) => ({ default: m.Picks })));
const Releases = lazy(() => import("../surfaces/Releases").then((m) => ({ default: m.Releases })));
const Sets = lazy(() => import("../surfaces/Sets").then((m) => ({ default: m.Sets })));
const SetPage = lazy(() => import("../surfaces/SetPage").then((m) => ({ default: m.SetPage })));
const Ask = lazy(() => import("../surfaces/Ask").then((m) => ({ default: m.Ask })));
const Eras = lazy(() => import("../surfaces/Eras").then((m) => ({ default: m.Eras })));
const Taste = lazy(() => import("../surfaces/Taste").then((m) => ({ default: m.Taste })));
const Skips = lazy(() => import("../surfaces/Skips").then((m) => ({ default: m.Skips })));
const Places = lazy(() => import("../surfaces/Places").then((m) => ({ default: m.Places })));
const SignIn = lazy(() => import("../surfaces/SignIn").then((m) => ({ default: m.SignIn })));
const Kit = import.meta.env.DEV ? lazy(() => import("../dev/Kit").then((m) => ({ default: m.Kit }))) : null;

const range = <RangePicker />;

export function App() {
  const session = useSession();
  if (session.isPending) return null;
  if (session.isError)
    return (
      <div className="mx-auto max-w-md px-5 pt-24">
        <ErrorState error={session.error} onRetry={() => session.refetch()} title="encore is not reachable" />
      </div>
    );
  if (!session.data.authenticated)
    return (
      <Suspense fallback={null}>
        <SignIn setupRequired={session.data.setupRequired} />
      </Suspense>
    );
  return (
    <Shell>
      <Suspense fallback={null}>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/plays" component={Plays} />

          <Route path="/music">
            <Redirect to="/music/artists" replace />
          </Route>
          <Route path="/music/artist/:name">{(p) => <ArtistPage key={p.name} name={paramValue(p.name)} />}</Route>
          <Route path="/music/album/:artist/:album">
            {(p) => <AlbumPage key={`${p.artist}/${p.album}`} artist={paramValue(p.artist)} album={paramValue(p.album)} />}
          </Route>
          <Route path="/music/song/:songKey">{(p) => <SongPage key={p.songKey} songKey={paramValue(p.songKey)} />}</Route>
          <Route path="/music/artists">{() => <Music tab="artists" />}</Route>
          <Route path="/music/albums">{() => <Music tab="albums" />}</Route>
          <Route path="/music/songs">{() => <Music tab="songs" />}</Route>
          <Route path="/music/forgotten">{() => <Music tab="forgotten" />}</Route>

          <Route path="/patterns">
            <Redirect to="/patterns/when" replace />
          </Route>
          <Route path="/patterns/when" component={When} />
          <Route path="/patterns/eras" component={Eras} />
          <Route path="/patterns/taste" component={Taste} />
          <Route path="/patterns/skips" component={Skips} />
          <Route path="/patterns/places" component={Places} />
          <Route path="/patterns/:tab">
            <Placeholder title="Patterns" description="How your listening is shaped: by hour, by era, by taste, by skips and by place." tabs={PATTERN_TABS} actions={range} />
          </Route>

          <Route path="/for-you">
            <Redirect to="/for-you/picks" replace />
          </Route>
          <Route path="/for-you/picks" component={Picks} />
          <Route path="/for-you/releases" component={Releases} />

          <Route path="/sets/:id">{(p) => <SetPage key={p.id} id={Number(p.id)} />}</Route>
          <Route path="/sets" component={Sets} />

          <Route path="/ask/:id?">{(p) => <Ask id={p.id} />}</Route>

          <Route path="/recaps/:id">{() => <Placeholder title="Recap" description="One weekly or monthly recap." />}</Route>
          <Route path="/recaps">
            <Placeholder title="Recaps" description="Weekly and monthly write-ups of your listening." />
          </Route>

          <Route path="/library">
            <Placeholder title="Library" description="Proposals to tidy saved songs and playlists, what you applied and can undo, and what you blocked." />
          </Route>

          <Route path="/setup">
            <Placeholder title="Setup" description="Connect Spotify, import your history and turn on the optional integrations." />
          </Route>

          <Route path="/settings">
            <Redirect to="/settings/general" replace />
          </Route>
          <Route path="/settings/:section">
            <Placeholder title="Settings" description="How encore runs: time zone, Spotify, Claude and its budget, Discord and MCP, jobs, and your passkeys." tabs={SETTINGS_TABS} />
          </Route>

          {Kit && <Route path="/dev/kit" component={Kit} />}

          <Route>
            <Placeholder title="Page not found" description="This address does not match a page in encore." />
          </Route>
        </Switch>
      </Suspense>
    </Shell>
  );
}
