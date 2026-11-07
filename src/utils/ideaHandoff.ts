/**
 * Opening the idea journal from somewhere else (a Council chat answer): the caller leaves a
 * prefill and fires an event; App opens the journal, which takes the prefill.
 */
export interface IdeaPrefill {
  iso3?: string;
  thesis?: string;
}

export const OPEN_IDEAS_EVENT = 'econquest:open-idea-journal';

let pending: IdeaPrefill | null = null;

export function openIdeaJournal(p: IdeaPrefill = {}): void {
  pending = p;
  window.dispatchEvent(new CustomEvent(OPEN_IDEAS_EVENT));
}

export function takeIdeaPrefill(): IdeaPrefill | null {
  const p = pending;
  pending = null;
  return p;
}
