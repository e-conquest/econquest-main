import React from 'react';
import { ArrowLeft, Briefcase, Globe2, Layers } from 'lucide-react';

/**
 * Research: one page that looks at the same questions at three zoom levels (Sam, 2026-11-05).
 * One country, the watchlist side by side, or your own holdings. The scope is the only switch;
 * each scope then uses the same section names.
 */
export type ResearchScope = 'country' | 'compare' | 'portfolio';

export const RESEARCH_SCOPES: ResearchScope[] = ['country', 'compare', 'portfolio'];

export function isResearchScope(area: string): area is ResearchScope {
  return (RESEARCH_SCOPES as string[]).includes(area);
}

/** Phone width: the same three choices in a word or two. */
export function shortScopeLabel(scope: ResearchScope, countryName: string): string {
  if (scope === 'country') return countryName.replace(/\s*\(.*\)$/, '');
  if (scope === 'compare') return 'Compare';
  return 'Holdings';
}

export function scopeLabel(scope: ResearchScope, countryName: string, holdingsCount: number): string {
  if (scope === 'country') return `One country: ${countryName}`;
  if (scope === 'compare') return 'Compare countries';
  return holdingsCount ? `My holdings (${holdingsCount})` : 'My holdings';
}

const ICON: Record<ResearchScope, React.ComponentType<{ className?: string }>> = {
  country: Globe2,
  compare: Layers,
  portfolio: Briefcase,
};

export const ResearchScopeBar: React.FC<{
  scope: ResearchScope;
  countryName: string;
  holdingsCount: number;
  onChange: (scope: ResearchScope) => void;
  /** After opening a country from Compare or My holdings: the way back. */
  cameFrom?: ResearchScope | null;
}> = ({ scope, countryName, holdingsCount, onChange, cameFrom }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-research-scope={scope}>
    <h1 className="ui-section-title text-base mr-1">Research</h1>
    <div role="group" aria-label="What to look at" className="flex flex-wrap gap-1.5">
      {RESEARCH_SCOPES.map((s) => {
        const Icon = ICON[s];
        return (
          <button
            key={s}
            type="button"
            data-scope={s}
            aria-pressed={scope === s}
            onClick={() => onChange(s)}
            className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap pointer-coarse:min-h-10"
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{scopeLabel(s, countryName, holdingsCount)}</span>
            <span className="sm:hidden">{shortScopeLabel(s, countryName)}</span>
          </button>
        );
      })}
    </div>
    {cameFrom && cameFrom !== scope && (
      <button
        type="button"
        onClick={() => onChange(cameFrom)}
        className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline"
        data-research-back={cameFrom}
      >
        <ArrowLeft className="w-3 h-3" />
        Back to {cameFrom === 'compare' ? 'Compare countries' : 'My holdings'}
      </button>
    )}
  </div>
);
