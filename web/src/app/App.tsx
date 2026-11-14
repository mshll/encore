import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { useSession } from "../api/queries";
import { SignIn } from "../screens/SignIn";
import { ErrorState } from "../ui/states";
import { Shell } from "./Shell";

const Overview = lazy(() => import("../screens/Overview"));
const Eras = lazy(() => import("../screens/Eras"));
const Clock = lazy(() => import("../screens/Clock"));
const Skips = lazy(() => import("../screens/Skips"));
const Forgotten = lazy(() => import("../screens/Forgotten"));
const Trips = lazy(() => import("../screens/Trips"));
const History = lazy(() => import("../screens/History"));
const Explore = lazy(() => import("../screens/Explore"));
const Entity = lazy(() => import("../screens/Entity"));
const Settings = lazy(() => import("../screens/Settings"));
const Session = lazy(() => import("../screens/Session"));
const Releases = lazy(() => import("../screens/Releases"));
const Cleanup = lazy(() => import("../screens/Cleanup"));

export function App() {
  const session = useSession();
  if (session.isPending) return null;
  if (session.isError)
    return (
      <div className="mx-auto max-w-md safe-x pt-24">
        <ErrorState error={session.error} onRetry={() => session.refetch()} title="encore is not reachable" />
      </div>
    );
  if (!session.data.authenticated) return <SignIn setupRequired={session.data.setupRequired} />;
  return (
    <Shell>
      <Suspense fallback={null}>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/eras" component={Eras} />
          <Route path="/clock" component={Clock} />
          <Route path="/skips" component={Skips} />
          <Route path="/forgotten" component={Forgotten} />
          <Route path="/trips" component={Trips} />
          <Route path="/history" component={History} />
          <Route path="/explore" component={Explore} />
          <Route path="/artist/:name">{(p) => <Entity kind="artist" artist={decodeURIComponent(p.name)} />}</Route>
          <Route path="/album/:artist/:album">{(p) => <Entity kind="album" artist={decodeURIComponent(p.artist)} album={decodeURIComponent(p.album)} />}</Route>
          <Route path="/song/:songKey">{(p) => <Entity kind="song" songKey={decodeURIComponent(p.songKey)} />}</Route>
          <Route path="/session" component={Session} />
          <Route path="/releases" component={Releases} />
          <Route path="/cleanup" component={Cleanup} />
          <Route path="/settings" component={Settings} />
          <Route>
            <div className="safe-x pt-10 md:px-10">
              <h1 className="text-heading-5 font-semibold">Page not found</h1>
              <p className="mt-2 text-secondary">This address does not match any page in encore.</p>
            </div>
          </Route>
        </Switch>
      </Suspense>
    </Shell>
  );
}
