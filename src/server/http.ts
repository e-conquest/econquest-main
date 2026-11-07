/**
 * Small fetch helpers shared by the feed readers. Each one gives up after a time limit.
 */

export async function fetchWithTimeout(url: string, timeoutMs = 4200): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout(url: string, ms = 8000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
export async function fetchTextWithTimeout(url: string, ms = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
