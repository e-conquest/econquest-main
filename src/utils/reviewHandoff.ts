/**
 * Starting a policy review from somewhere else (a Council chat answer, Review again): the page
 * that asks leaves a prefill here and fires an event; App opens Reports, and the Policy reviews
 * panel picks the prefill up when it mounts (or at once if it is already showing).
 */
export interface ReviewPrefill {
  iso3?: string;
  problem?: string;
  previousId?: string;
}

export const START_REVIEW_EVENT = 'econquest:start-policy-review';

let pending: ReviewPrefill | null = null;

export function startPolicyReview(p: ReviewPrefill): void {
  pending = p;
  window.dispatchEvent(new CustomEvent(START_REVIEW_EVENT));
}

/** The prefill waiting, if any; taking it clears it. */
export function takeReviewPrefill(): ReviewPrefill | null {
  const p = pending;
  pending = null;
  return p;
}
