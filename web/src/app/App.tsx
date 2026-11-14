import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import { useSession } from "../api/queries";
import { ErrorState } from "../ui/States";
import { Placeholder } from "../surfaces/Placeholder";
import { RangePicker } from "../ui/RangePicker";
import { FOR_YOU_TABS, MUSIC_TABS, PATTERN_TABS } from "./nav";
import { Shell } from "./Shell";

const Overview = lazy(() => import("../surfaces/Overview").then((m) => ({ default: m.Overview })));
const Plays = lazy(() => import("../surfaces/Plays").then((m) => ({ default: m.Plays })));
const When = lazy(() => import("../surfaces/When").then((m) => ({ default: m.When })));
const Setup = lazy(() => import("../surfaces/Setup").then((m) => ({ default: m.Setup })));
const Settings = lazy(() => import("../surfaces/Settings").then((m) => ({ default: m.Settings })));
const Recaps = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.Recaps })));
const Recap = lazy(() => import("../surfaces/Recaps").then((m) => ({ default: m.Recap })));
const Library = lazy(() => import("../surfaces/Library").then((m) => ({ default: m.Library })));
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
          <Route path="/music/artist/:name">
            {(p) => <Placeholder title={decodeURIComponent(p.name)} description="One artist: time listened, songs and albums ranked, when you play them, skips and new releases." actions={range} />}
          </Route>
          <Route path="/music/album/:artist/:album">
            {(p) => <Placeholder title={decodeURIComponent(p.album)} description={`Album by ${decodeURIComponent(p.artist)}: every song with plays and skips, and listening over time.`} actions={range} />}
          </Route>
          <Route path="/music/song/:songKey">
            {() => <Placeholder title="Song" description="One song: plays over time, where it gets skipped and where it sticks, versions, and liner notes." actions={range} />}
          </Route>
          <Route path="/music/:tab">
            <Placeholder title="Music" description="Everything you have played, ranked: artists, albums and songs, and favourites you stopped playing." tabs={MUSIC_TABS} actions={range} />
          </Route>

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

          <Route path="/recaps/:id">{(p) => <Recap key={p.id} id={Number(p.id)} />}</Route>
          <Route path="/recaps" component={Recaps} />

          <Route path="/library" component={Library} />

          <Route path="/setup" component={Setup} />

          <Route path="/settings">
            <Redirect to="/settings/general" replace />
          </Route>
          <Route path="/settings/:section">{(p) => <Settings section={p.section} />}</Route>

          {Kit && <Route path="/dev/kit" component={Kit} />}

          <Route>
            <Placeholder title="Page not found" description="This address does not match a page in encore." />
          </Route>
        </Switch>
      </Suspense>
    </Shell>
  );
}
