export class LlmNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
  }
}

export class LlmBudgetExceededError extends Error {
  constructor(
    readonly month: string,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Monthly LLM budget reached for ${month}: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`);
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
