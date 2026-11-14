import type { ReactNode } from "react";
import { RocketLaunchIcon } from "../ui/icons";
import { Page, PageHeader } from "../ui/Page";
import { EmptyState } from "../ui/States";
import { TabNav, type TabNavItem } from "../ui/TabNav";

/** A routed surface from the new IA that phase 2 builds. Header and tabs are real; the body says so. */
export function Placeholder({ title, description, tabs, tabsLabel, actions }: { title: string; description: string; tabs?: TabNavItem[]; tabsLabel?: string; actions?: ReactNode }) {
  return (
    <Page>
      <PageHeader title={title} description={description} actions={actions}>
        {tabs && <TabNav items={tabs} label={tabsLabel ?? title} />}
      </PageHeader>
      <EmptyState icon={RocketLaunchIcon} size="page" title="Not built yet" description="This page is part of the next build phase." />
    </Page>
  );
}
