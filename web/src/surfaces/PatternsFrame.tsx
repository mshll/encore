import type { ReactNode } from "react";
import { useLifetime } from "../api/queries";
import { PATTERN_TABS } from "../app/nav";
import { AppLink } from "../ui/AppLink";
import { buttonClass } from "../ui/Button";
import type { IconGlyph } from "../ui/Icon";
import { Page, PageHeader } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { EmptyState } from "../ui/States";
import { TabNav } from "../ui/TabNav";

/** Header, tabs and range for a Patterns tab; before any play is imported, the first-use state stands in for the body. */
export function PatternsFrame({ icon, firstUse, children }: { icon: IconGlyph; firstUse: string; children: ReactNode }): ReactNode {
  const lifetime = useLifetime();
  const isNew = lifetime.data?.plays === 0;
  return (
    <Page>
      <PageHeader title="Patterns" actions={!isNew && <RangePicker />}>
        <TabNav items={PATTERN_TABS} label="Patterns" />
      </PageHeader>
      {isNew ? (
        <EmptyState
          size="page"
          icon={icon}
          title="No listening yet"
          description={firstUse}
          action={
            <AppLink to="/setup" className={buttonClass({ variant: "primary" })}>
              Set up encore
            </AppLink>
          }
        />
      ) : (
        children
      )}
    </Page>
  );
}
