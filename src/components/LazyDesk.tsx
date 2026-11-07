import React, { lazy } from 'react';

/**
 * React.lazy for a named export, so desks can be split out of the main bundle
 * without changing how they are exported.
 */
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K
): M[K] {
  return lazy(async () => ({ default: (await load())[name] as React.ComponentType<unknown> })) as unknown as M[K];
}

/** Shown for the moment a desk's code is downloading. */
export const DeskLoading: React.FC = () => (
  <div className="ui-panel p-6" role="status" aria-live="polite">
    <p className="ui-label">Loading desk…</p>
  </div>
);
