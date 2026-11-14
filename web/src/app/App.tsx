import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import { useSession } from "../api/queries";
import { ErrorState } from "../ui/States";
import { Placeholder } from "../surfaces/Placeholder";
import { RangePicker } from "../ui/RangePicker";
import { FOR_YOU_TABS, PATTERN_TABS, SETTINGS_TABS } from "./nav";
import { Shell } from "./Shell";

const Overview = lazy(() => import("../surfaces/Overview").then((m) => ({ default: m.Overview })));
const Plays = lazy(() => import("../surfaces/Plays").then((m) => ({ default: m.Plays })));
const When = lazy(() => import("../surfaces/When").then((m) => ({ default: m.When })));
const Music = lazy(() => import("../surfaces/Music").then((m) => ({ default: m.Music })));
const ArtistPage = lazy(() => import("../surfaces/entity/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const AlbumPage = lazy(() => import("../surfaces/entity/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const SongPage = lazy(() => import("../surfaces/entity/SongPage").then((m) => ({ default: m.SongPage })));
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
          <Route path="/music/artist/:name">{(p) => <ArtistPage key={p.name} name={decodeURIComponent(p.name)} />}</Route>
          <Route path="/music/album/:artist/:album">
            {(p) => <AlbumPage key={`${p.artist}/${p.album}`} artist={decodeURIComponent(p.artist)} album={decodeURIComponent(p.album)} />}
          </Route>
          <Route path="/music/song/:songKey">{(p) => <SongPage key={p.songKey} songKey={decodeURIComponent(p.songKey)} />}</Route>
          <Route path="/music/artists">{() => <Music tab="artists" />}</Route>
          <Route path="/music/albums">{() => <Music tab="albums" />}</Route>
          <Route path="/music/songs">{() => <Music tab="songs" />}</Route>
          <Route path="/music/forgotten">{() => <Music tab="forgotten" />}</Route>

          <Route path="/patterns">
            <Redirect to="/patterns/when" replace />
          </Route>
          <Route path="/patterns/when" component={When} />
          <Route path="/patterns/:tab">
            <Placeholder title="Patterns" description="How your listening is shaped: by hour, by era, by taste, by skips and by place." tabs={PATTERN_TABS} actions={range} />
          </Route>

          <Route path="/for-you">
            <Redirect to="/for-you/picks" replace />
          </Route>
          <Route path="/for-you/:tab">
            <Placeholder title="For you" description="This week's picks from Claude and new releases from artists you play." tabs={FOR_YOU_TABS} />
          </Route>

          <Route path="/sets/:id">{() => <Placeholder title="Set" description="One set: its tracks, the reasons, and a chat to change it." />}</Route>
          <Route path="/sets">
            <Placeholder title="Sets" description="Playlists Claude builds from a prompt and your history, played as a session that adapts to skips." />
          </Route>

          <Route path="/ask/:id">{() => <Placeholder title="Ask" description="A conversation about your listening." />}</Route>
          <Route path="/ask">
            <Placeholder title="Ask" description="Questions about your listening, answered from your history." />
          </Route>

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
