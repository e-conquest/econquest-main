/**
 * Checks that keep the local server for this computer's own pages.
 *
 * - Host check: a hostile website can point its own domain name at 127.0.0.1 ("DNS rebinding")
 *   and then talk to this server as if it were the app. Such requests carry that site's name in
 *   the Host header, so only localhost names (plus any listed in ALLOWED_HOSTS) are accepted.
 * - Origin check: a request that changes something (POST, PUT, DELETE, PATCH) and comes from a
 *   page on another site is refused, even if the browser would send it.
 * - Outbound URL check: the connector test and webhook buttons fetch a URL on the server. They may
 *   not be pointed back at this app itself or at cloud metadata addresses.
 */

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal']);

/** "Example.com:3000" -> "example.com"; "[::1]:3000" -> "[::1]". */
export function hostName(hostHeader: string | undefined): string {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  return h.split(':')[0];
}

function isLoopbackName(name: string): boolean {
  return LOCAL_NAMES.has(name) || /^127\.\d+\.\d+\.\d+$/.test(name) || name.endsWith('.localhost');
}

export interface GuardEnv {
  HOST?: string;
  ALLOWED_HOSTS?: string;
}

/** Extra host names allowed by ALLOWED_HOSTS (comma separated), e.g. "my-mac.local,192.168.1.20". */
export function allowedHosts(env: GuardEnv): string[] {
  return String(env.ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => hostName(s.trim()))
    .filter(Boolean);
}

/**
 * Whether the Host header names this computer. When the app is opened to the network on purpose
 * (HOST=0.0.0.0 or another non-local address) and ALLOWED_HOSTS is empty, any host name is
 * accepted, as before; list the names in ALLOWED_HOSTS to tighten it.
 */
export function hostAllowed(hostHeader: string | undefined, env: GuardEnv): boolean {
  const name = hostName(hostHeader);
  if (!name) return false;
  if (isLoopbackName(name)) return true;
  const extra = allowedHosts(env);
  if (extra.includes(name)) return true;
  const bind = String(env.HOST || '').trim().toLowerCase();
  const openToNetwork = bind !== '' && !isLoopbackName(bind);
  return openToNetwork && extra.length === 0;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Whether a request may change something. Reads are always allowed here (the Host check covers
 * them). Writes are refused when the browser says they come from another site.
 */
export function writeAllowed(
  method: string,
  headers: { origin?: string; host?: string; 'sec-fetch-site'?: string }
): boolean {
  if (!WRITE_METHODS.has(String(method).toUpperCase())) return true;
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') return false;
  const origin = String(headers.origin || '').trim();
  if (!origin || origin === 'null') return origin !== 'null';
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host || '').trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Problem with a URL the server is asked to fetch for a connector test or webhook, or null when
 * it may be fetched. Internal hosts on your network stay allowed (that is what the connectors are
 * for); this app itself and cloud metadata addresses are not.
 */
export function outboundUrlProblem(raw: string, ownPort: number | string): string | null {
  let url: URL;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return 'That is not a valid web address.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http:// and https:// addresses can be used.';
  const name = url.hostname.toLowerCase();
  if (name === '169.254.169.254' || name.startsWith('169.254.') || name === 'metadata.google.internal' || name === '[fd00:ec2::254]') {
    return 'Cloud metadata addresses cannot be used.';
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if ((isLoopbackName(name) || name === '[::1]' || name === '0.0.0.0') && port === String(ownPort)) {
    return 'This app cannot be pointed at itself.';
  }
  return null;
}

/** Copy of the runtime settings without the integration API key and webhook secret. */
export function withoutSecrets<T extends { integrationConfig?: object }>(cfg: T): T {
  if (!cfg?.integrationConfig) return cfg;
  const { apiKey: _k, webhookHmacSecret: _s, ...rest } = cfg.integrationConfig as Record<string, unknown>;
  return { ...cfg, integrationConfig: { ...rest, apiKeySet: Boolean(_k), webhookSecretSet: Boolean(_s) } } as T;
}
