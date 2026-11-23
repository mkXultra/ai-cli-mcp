export const DEFAULT_JEV_VERSION = 'jev-1.13.0';
export const PROVIDER_ID = 'cloudflare/typesafe/jev';
export type JevQuestion = { type: 'noul'; instructions: string };
export type JevRequest = { state: { instructions: string }; questions: Record<string, JevQuestion> };
export type JevResult = { model: string; answers: Record<string, { type: 'noul'; noul: number }>; usage?: unknown };
export interface Provider {
  id: string; version: string;
  evaluate(request: JevRequest): Promise<JevResult>;
}

export function validateResult(value: unknown, request: JevRequest, version: string): JevResult {
  const result = value as JevResult | null;
  if (!result || result.model !== version) throw new Error(`Jev version mismatch; expected ${version}. Check the served version before changing --jev-version.`);
  if (!result.answers || typeof result.answers !== 'object' || Array.isArray(result.answers)) throw new Error('Malformed Jev answers');
  const keys = Object.keys(request.questions);
  if (Object.keys(result.answers).length !== keys.length || Object.keys(result.answers).some(k => !Object.hasOwn(request.questions, k))) {
    throw new Error('Jev returned missing or extra answers');
  }
  for (const key of keys) {
    const answer = result.answers[key];
    if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number' ||
        !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error(`Invalid Noul answer for ${key}`);
  }
  return result;
}

export function cloudflareProvider(options: {
  env: NodeJS.ProcessEnv; version?: string; fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number) => void;
}): Provider {
  const version = options.version ?? DEFAULT_JEV_VERSION;
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  return {
    id: PROVIDER_ID, version,
    async evaluate(request) {
      // Read credentials only on a cache miss; offline/cache-only runs need none.
      const account = options.env.CLOUDFLARE_ACCOUNT_ID;
      const token = options.env.CLOUDFLARE_API_TOKEN;
      if (!account || !/^[a-fA-F0-9]{32}$/.test(account) || !token?.trim()) {
        throw new Error('Set CLOUDFLARE_ACCOUNT_ID (32 hex characters) and CLOUDFLARE_API_TOKEN, or use --env-file');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'typesafe/jev', input: request }), signal: AbortSignal.timeout(60_000),
          });
        } catch {
          // Transport error text can contain headers/URLs. Do not persist it.
          if (attempt === 2) throw new Error('Jev network request failed after 3 attempts');
          options.onRetry?.(attempt + 1); await sleep(1000 * 2 ** attempt); continue;
        }
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          await response.body?.cancel();
          if (!retryable || attempt === 2) throw new Error(`Jev HTTP ${response.status}`);
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : 1000 * 2 ** attempt;
          options.onRetry?.(attempt + 1); await sleep(delay); continue;
        }
        let payload: { success?: boolean; result?: unknown };
        try { payload = await response.json() as typeof payload; }
        catch { throw new Error('Jev returned invalid JSON'); }
        if (!payload || payload.success !== true || !payload.result) throw new Error('Jev returned an unsuccessful response');
        // The generic Cloudflare endpoint may wrap third-party results in
        // {state, result, gatewayMetadata} inside its normal response envelope.
        let result: unknown = payload.result;
        for (let depth = 0; depth < 4; depth++) {
          if (!result || typeof result !== 'object') break;
          const wrapper = result as Record<string, unknown>;
          if (wrapper.success === false) throw new Error('Jev returned an unsuccessful response');
          if (Object.hasOwn(wrapper, 'answers') || !Object.hasOwn(wrapper, 'result')) break;
          result = wrapper.result;
        }
        return validateResult(result, request, version);
      }
      throw new Error('Jev request failed');
    },
  };
}
