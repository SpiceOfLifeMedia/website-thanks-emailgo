export const API_RATE_LIMIT_WINDOW_MS = 60_000;

export type ApiRateLimitState = {
  limit: number;
  remaining: number;
  resetAtMs: number;
  allowed: boolean;
};

export function apiRateLimitState(requestCount: number, limit: number, windowStartedAtMs: number): ApiRateLimitState {
  return {
    limit,
    remaining: Math.max(0, limit - requestCount),
    resetAtMs: windowStartedAtMs + API_RATE_LIMIT_WINDOW_MS,
    allowed: requestCount <= limit,
  };
}

export function apiRateLimitHeaders(state: ApiRateLimitState, nowMs = Date.now()): Record<string, string> {
  const secondsUntilReset = Math.max(0, Math.ceil((state.resetAtMs - nowMs) / 1000));
  return {
    'ratelimit-limit': String(state.limit),
    'ratelimit-remaining': String(state.remaining),
    'ratelimit-reset': String(secondsUntilReset),
    ...(!state.allowed ? { 'retry-after': String(Math.max(1, secondsUntilReset)) } : {}),
  };
}

export function withApiRateLimitHeaders(response: Response, state: ApiRateLimitState, nowMs = Date.now()): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(apiRateLimitHeaders(state, nowMs))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
