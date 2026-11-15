import "@fontsource-variable/geist";
import "@fontsource-variable/bricolage-grotesque";
import "./styles/app.css";
import "./lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, setUnauthenticatedHandler } from "./api/client";
import { App } from "./app/App";
import { recoverFromStaleChunks } from "./lib/chunkRecovery";

recoverFromStaleChunks();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

setUnauthenticatedHandler(() => {
  queryClient.setQueryData(["session"], (prev: { setupRequired: boolean } | undefined) => ({
    authenticated: false,
    setupRequired: prev?.setupRequired ?? false,
  }));
});

const fixtures = import.meta.env.DEV ? import("./dev/fixtures") : Promise.resolve();

void fixtures.then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  ),
);
