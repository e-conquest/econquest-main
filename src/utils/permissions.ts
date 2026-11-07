/**
 * Roles (Sam, 2026-11-06), as set out in docs/RISK_AND_COMPLIANCE.md:
 *   - Viewer: reads Research, Reports and the council's saved answers; keeps own watchlists and
 *     holdings; changes nothing shared.
 *   - Analyst: asks the council, saves research, runs reviews and backtests, refreshes data.
 *   - Admin: also data and AI keys, AI model settings, backup and restore, the audit log,
 *     connectors and webhooks, and other people's accounts (Menu > Users).
 * While sign-in is off (no accounts, this computer only) the single user can do everything.
 *
 * One table decides it for every API call, so a new route is Analyst unless listed here.
 * Browser-safe: no server imports.
 */
import type { Role } from './auth';

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };

export function roleAtLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

/** Paths only an admin may use, whatever the method. */
const ADMIN_ANY: RegExp[] = [
  /^\/api\/settings(\/|$)/,
  /^\/api\/users(\/|$)/,
  /^\/api\/backup(\/|$)/,
  /^\/api\/audit(\/|$)/,
  /^\/api\/connectors(\/|$)/,
];

/** Changes only an admin may make. */
const ADMIN_WRITE: RegExp[] = [
  /^\/api\/ai\/runtime-config-save$/,
  /^\/api\/ai\/ollama-pull$/,
  /^\/api\/council\/webhook-dispatch$/,
  /^\/api\/morning-brief$/,
  /^\/api\/watch-rules$/,
];

/** Changes a viewer may still make: their own sign-in, password and workspace (own lists and holdings). */
const VIEWER_WRITE: RegExp[] = [/^\/api\/auth\//, /^\/api\/workspace\//];

const WRITE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function requiredRole(method: string, pathname: string): Role {
  const p = pathname.split('?')[0];
  const write = WRITE.has(method.toUpperCase());
  // GET /api/settings/keys shows which keys are set (masked) so Analysts see why a figure is Missing.
  if (!write && p === '/api/settings/keys') return 'analyst';
  if (ADMIN_ANY.some((r) => r.test(p))) return 'admin';
  if (!p.startsWith('/api/')) return 'viewer';
  if (write) {
    if (ADMIN_WRITE.some((r) => r.test(p))) return 'admin';
    if (VIEWER_WRITE.some((r) => r.test(p))) return 'viewer';
    return 'analyst';
  }
  return 'viewer';
}

export const ROLE_CAN: Record<Role, string> = {
  viewer: 'Reads Research, Reports and saved council answers. Cannot ask the council or change anything shared.',
  analyst: 'Asks the council, saves research, runs reviews and backtests, refreshes data.',
  admin: 'Everything, plus data and AI keys, AI settings, backup and restore, the audit log and accounts.',
};

export function refusal(role: Role, needed: Role): string {
  const label: Record<Role, string> = { viewer: 'a Viewer', analyst: 'an Analyst', admin: 'an Admin' };
  const who = needed === 'admin' ? 'an Admin' : 'an Analyst or Admin';
  return `Your account is ${label[role]}. Only ${who} can do this; ask your admin.`;
}
