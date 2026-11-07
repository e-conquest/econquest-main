/** Browser-safe labels for accounts (src/utils/auth.ts is server-only). */
import type { Role } from './auth';

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', analyst: 'Analyst', viewer: 'Viewer' };
