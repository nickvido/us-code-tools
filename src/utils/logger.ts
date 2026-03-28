export type LogLevel = 'info' | 'warn' | 'error';

export interface NetworkLogEvent {
  level: LogLevel;
  event: string;
  source: string;
  method: string;
  url: string;
  attempt: number;
  cache_status: 'hit' | 'miss' | 'bypass';
  duration_ms: number;
  status_code?: number;
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('api_key')) {
      parsed.searchParams.set('api_key', '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return url.replace(/api_key=[^&]+/g, 'api_key=[REDACTED]');
  }
}

export function logNetworkEvent(event: NetworkLogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    ...event,
    url: redactUrl(event.url),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
