export const SEND_RATE_LIMIT_WINDOW_MS = 60_000;

export type SendRateLimitState = {
  limit: number;
  remaining: number;
  resetAtMs: number;
  allowed: boolean;
};

export function sendRateLimitState(requestCount: number, limit: number, windowStartedAtMs: number): SendRateLimitState {
  return {
    limit,
    remaining: Math.max(0, limit - requestCount),
    resetAtMs: windowStartedAtMs + SEND_RATE_LIMIT_WINDOW_MS,
    allowed: requestCount <= limit,
  };
}

export function sendRateLimitHeaders(state: SendRateLimitState, nowMs = Date.now()): Record<string, string> {
  const secondsUntilReset = Math.max(0, Math.ceil((state.resetAtMs - nowMs) / 1000));
  return {
    'ratelimit-limit': String(state.limit),
    'ratelimit-remaining': String(state.remaining),
    'ratelimit-reset': String(secondsUntilReset),
    ...(!state.allowed ? { 'retry-after': String(Math.max(1, secondsUntilReset)) } : {}),
  };
}

export function withSendRateLimitHeaders(response: Response, state: SendRateLimitState, nowMs = Date.now()): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(sendRateLimitHeaders(state, nowMs))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
