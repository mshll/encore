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
      <h1 className="sr-only">Not found</h1>
      <EmptyState
        size="page"
        title="This page does not exist"
        action={
          <AppLink to="/" className={buttonClass()}>
            Open Home
          </AppLink>
        }
      />
    </Page>
  );
}
