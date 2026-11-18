export class LlmNotConfiguredError extends Error {
  constructor() {
    super("AI is not set up: choose a provider, model and API key in Settings");
  }
}

export class LlmBudgetExceededError extends Error {
  constructor(
    readonly month: string,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Monthly AI budget reached for ${month}: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`);
  }
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined the request${category ? ` (${category})` : ""}`);
  }
}

export class LlmTruncatedError extends Error {
  constructor() {
    super("The model reached max_tokens before finishing");
  }
}

export class LlmIncompleteError extends Error {}

export class LlmAbortedError extends Error {
  constructor() {
    super("The request was cancelled");
  }
}

/** The provider refused or failed the request. Carries the HTTP status only: provider messages can echo request details. */
export class LlmProviderError extends Error {
  constructor(
    readonly status: number | null,
    kind?: string,
  ) {
    super(`AI provider error${status ? ` ${status}` : kind ? ` (${kind})` : ""}`);
  }
}
