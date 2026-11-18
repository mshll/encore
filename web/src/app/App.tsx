import { lazy, Suspense } from "react";
import { Redirect, Route, Switch, useRoute } from "wouter";
import { useSession } from "../api/queries";
import { ErrorState } from "../ui/States";
import { NotFound } from "../surfaces/NotFound";
import { LEGACY_CHAT, paramValue } from "./paths";
import { Shell } from "./Shell";

const Home = lazy(() => import("../surfaces/Home").then((m) => ({ default: m.Home })));
const Plays = lazy(() => import("../surfaces/Plays").then((m) => ({ default: m.Plays })));
const When = lazy(() => import("../surfaces/When").then((m) => ({ default: m.When })));
const Discovery = lazy(() => import("../surfaces/Discovery").then((m) => ({ default: m.Discovery })));
const Records = lazy(() => import("../surfaces/Records").then((m) => ({ default: m.Records })));
const Music = lazy(() => import("../surfaces/Music").then((m) => ({ default: m.Music })));
const ArtistPage = lazy(() => import("../surfaces/entity/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const AlbumPage = lazy(() => import("../surfaces/entity/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const SongPage = lazy(() => import("../surfaces/entity/SongPage").then((m) => ({ default: m.SongPage })));
const Playlists = lazy(() => import("../surfaces/playlists/List").then((m) => ({ default: m.Playlists })));
const PlaylistPage = lazy(() => import("../surfaces/playlists/PlaylistPage").then((m) => ({ default: m.PlaylistPage })));
const RuleBuilder = lazy(() => import("../surfaces/playlists/RuleBuilder").then((m) => ({ default: m.RuleBuilder })));
const ChatPage = lazy(() => import("../surfaces/ChatPage").then((m) => ({ default: m.ChatPage })));
const Eras = lazy(() => import("../surfaces/Eras").then((m) => ({ default: m.Eras })));
const Taste = lazy(() => import("../surfaces/Taste").then((m) => ({ default: m.Taste })));
const Skips = lazy(() => import("../surfaces/Skips").then((m) => ({ default: m.Skips })));
const Places = lazy(() => import("../surfaces/Places").then((m) => ({ default: m.Places })));
const Setup = lazy(() => import("../surfaces/Setup").then((m) => ({ default: m.Setup })));
const Settings = lazy(() => import("../surfaces/Settings").then((m) => ({ default: m.Settings })));
const Recaps = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.Recaps })));
const RecapById = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.RecapById })));
const RecapKindLatest = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.RecapKindLatest })));
const RecapPeriodPage = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.RecapPeriodPage })));
const LibraryOverview = lazy(() => import("../surfaces/library/Overview").then((m) => ({ default: m.LibraryOverview })));
const LibrarySongs = lazy(() => import("../surfaces/library/Songs").then((m) => ({ default: m.LibrarySongs })));
const LibraryPlans = lazy(() => import("../surfaces/library/Plans").then((m) => ({ default: m.LibraryPlans })));
const PlanPage = lazy(() => import("../surfaces/library/PlanPage").then((m) => ({ default: m.PlanPage })));
const PlanThreadPage = lazy(() => import("../surfaces/library/PlanThread").then((m) => ({ default: m.PlanThreadPage })));
const LibraryInstructions = lazy(() => import("../surfaces/library/Instructions").then((m) => ({ default: m.LibraryInstructions })));
const Connect = lazy(() => import("../surfaces/Connect").then((m) => ({ default: m.Connect })));
const SignIn = lazy(() => import("../surfaces/SignIn").then((m) => ({ default: m.SignIn })));
const Kit = import.meta.env.DEV ? lazy(() => import("../dev/Kit").then((m) => ({ default: m.Kit }))) : null;

export function App() {
  const session = useSession();
  const [connecting, connect] = useRoute("/connect/:id");
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
  if (connecting)
    return (
      <Suspense fallback={null}>
        <Connect key={connect.id} id={connect.id} />
      </Suspense>
    );
  return (
    <Shell>
      <Suspense fallback={null}>
        <Switch>
          <Route path="/" component={Home} />
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
          <Route path="/music/podcasts">{() => <Music tab="podcasts" />}</Route>

          <Route path="/patterns">
            <Redirect to="/patterns/when" replace />
          </Route>
          <Route path="/patterns/when" component={When} />
          <Route path="/patterns/eras" component={Eras} />
          <Route path="/patterns/taste" component={Taste} />
          <Route path="/patterns/discovery" component={Discovery} />
          <Route path="/patterns/records" component={Records} />
          <Route path="/patterns/skips" component={Skips} />
          <Route path="/patterns/places" component={Places} />

          <Route path="/playlists" component={Playlists} />
          <Route path="/playlists/new">{() => <RuleBuilder />}</Route>
          <Route path="/playlists/:id/edit">{(p) => <RuleBuilder key={p.id} id={p.id} />}</Route>
          <Route path="/playlists/:id">{(p) => <PlaylistPage key={p.id} id={p.id} />}</Route>

          <Route path="/for-you">
            <Redirect to="/playlists" replace />
          </Route>
          <Route path="/for-you/:kind">{(p) => <Redirect to={`/playlists/${p.kind}`} replace />}</Route>
          <Route path="/sets">
            <Redirect to="/playlists?show=sets" replace />
          </Route>
          <Route path="/sets/:id">{(p) => <Redirect to={`/playlists/set-${p.id}`} replace />}</Route>

          <Route path="/chat/:id?">{(p) => <ChatPage id={p.id} />}</Route>
          <Route path="/ask/:id?">{() => <Redirect to={LEGACY_CHAT} replace />}</Route>

          <Route path="/recaps/:slug/:key">{(p) => <RecapPeriodPage slug={p.slug} periodKey={p.key} />}</Route>
          <Route path="/recaps/:id">{(p) => (/^\d+$/.test(p.id) ? <RecapById key={p.id} id={Number(p.id)} /> : <RecapKindLatest key={p.id} slug={p.id} />)}</Route>
          <Route path="/recaps" component={Recaps} />

          <Route path="/library" component={LibraryOverview} />
          <Route path="/library/songs" component={LibrarySongs} />
          <Route path="/library/plans" component={LibraryPlans} />
          <Route path="/library/plans/:id">{(p) => <PlanPage key={p.id} id={Number(p.id)} />}</Route>
          <Route path="/library/claude/:id">{(p) => <PlanThreadPage key={p.id} threadId={Number(p.id)} />}</Route>
          <Route path="/library/instructions" component={LibraryInstructions} />

          <Route path="/setup" component={Setup} />

          <Route path="/settings">
            <Redirect to="/settings/general" replace />
          </Route>
          <Route path="/settings/claude">
            <Redirect to="/settings/ai" replace />
          </Route>
          <Route path="/settings/:section">{(p) => <Settings section={p.section} />}</Route>

          {Kit && <Route path="/dev/kit" component={Kit} />}

          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Shell>
  );
}
