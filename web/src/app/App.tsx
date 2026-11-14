import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import { useSession } from "../api/queries";
import { ErrorState } from "../ui/States";
import { NotFound } from "../surfaces/NotFound";
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
const Setup = lazy(() => import("../surfaces/Setup").then((m) => ({ default: m.Setup })));
const Settings = lazy(() => import("../surfaces/Settings").then((m) => ({ default: m.Settings })));
const Recaps = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.Recaps })));
const Recap = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.Recap })));
const Library = lazy(() => import("../surfaces/Library").then((m) => ({ default: m.Library })));
const SignIn = lazy(() => import("../surfaces/SignIn").then((m) => ({ default: m.SignIn })));
const Kit = import.meta.env.DEV ? lazy(() => import("../dev/Kit").then((m) => ({ default: m.Kit }))) : null;

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
        <SignIn />
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

          <Route path="/for-you">
            <Redirect to="/for-you/picks" replace />
          </Route>
          <Route path="/for-you/picks" component={Picks} />
          <Route path="/for-you/releases" component={Releases} />

          <Route path="/sets/:id">{(p) => <SetPage key={p.id} id={Number(p.id)} />}</Route>
          <Route path="/sets" component={Sets} />

          <Route path="/ask/:id?">{(p) => <Ask id={p.id} />}</Route>

          <Route path="/recaps/:id">{(p) => <Recap key={p.id} id={Number(p.id)} />}</Route>
          <Route path="/recaps" component={Recaps} />

          <Route path="/library" component={Library} />

          <Route path="/setup" component={Setup} />

          <Route path="/settings">
            <Redirect to="/settings/general" replace />
          </Route>
          <Route path="/settings/:section">{(p) => <Settings section={p.section} />}</Route>

          {Kit && <Route path="/dev/kit" component={Kit} />}

          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Shell>
  );
}
