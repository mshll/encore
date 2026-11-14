import type { ReactNode } from "react";
import { AppLink } from "../ui/AppLink";
import { buttonClass } from "../ui/Button";
import { Page, useDocumentTitle } from "../ui/Page";
import { EmptyState } from "../ui/States";

/** An address that matches no surface. */
export function NotFound(): ReactNode {
  useDocumentTitle("Not found");
  return (
    <Page>
      <EmptyState
        size="page"
        title="This page does not exist"
        action={
          <AppLink to="/" className={buttonClass()}>
            Open Overview
          </AppLink>
        }
      />
    </Page>
  );
}
