import type { ReactNode } from "react";
import { useLibraryAnalysis } from "../../api/queries";
import { LIBRARY_TABS } from "../../app/nav";
import { fmtAgo, fmtInt } from "../../lib/format";
import { Page, PageHeader } from "../../ui/Page";
import { TabNav } from "../../ui/TabNav";

/** The Library header and its tabs: Overview, Plans, Instructions. A tab supplies its body. */
export function LibraryFrame({ children, actions, width }: { children: ReactNode; actions?: ReactNode; width?: "read" }) {
  const lib = useLibraryAnalysis().data?.library;
  const counts = lib && `${fmtInt(lib.savedTracks)} liked songs and ${fmtInt(lib.playlists)} playlists`;
  const description = lib && (lib.syncing ? `${counts}. Syncing now.` : lib.lastSyncAt ? `${counts}, synced ${fmtAgo(lib.lastSyncAt)}.` : undefined);
  return (
    <Page width={width}>
      <PageHeader title="Library" description={description} actions={actions}>
        <TabNav items={LIBRARY_TABS} label="Library" />
      </PageHeader>
      {children}
    </Page>
  );
}
