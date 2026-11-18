import { useStatus } from "../api/queries";

/** Whether an AI provider is set up. `known` is false until status loads, so AI entry points never flash in and out. */
export type Ai = { known: boolean; configured: boolean };

/** The one place the UI reads whether AI features exist. */
export function useAi(): Ai {
  const ai = useStatus().data?.ai;
  return { known: ai !== undefined, configured: ai?.configured === true };
}
