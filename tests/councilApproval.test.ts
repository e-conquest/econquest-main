import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_ASSUMPTIONS, changedAssumptions } from '../src/components/CouncilApprovalCard.tsx';
import type { CROOverrideState } from '../src/types/council.ts';

const desk = {
  geopoliticalRiskScore: 0.6,
  sovereignRiskScore: 0.5,
  macroRiskScore: 0.4,
  energyInflationShockPct: 12,
  debtServicingSpreadBps: 85,
  fxReserveAdequacyMonths: 4.2,
  politicalWillIndex: 0.55,
  counterfactualShocks: { brentCrudeShockUsd: 0, fedTerminalRateShockBps: 0, chokepointTransitDropPct: 0, domesticFiscalSlippagePctGdp: 0 },
  croNotes: '',
  croApproverName: '',
  isOverridden: false,
} as CROOverrideState;

test('approval card: lists every assumption in plain words and spots the ones the reviewer changed', () => {
  assert.equal(APPROVAL_ASSUMPTIONS.length, 11);
  assert.deepEqual(changedAssumptions(desk, { ...desk }), []);
  assert.deepEqual(changedAssumptions(desk, { ...desk, croNotes: 'notes do not count' }), []);
  // Edits go through the same setters the card's sliders use.
  const geo = APPROVAL_ASSUMPTIONS.find((a) => a.id === 'geopoliticalRiskScore')!;
  const oil = APPROVAL_ASSUMPTIONS.find((a) => a.id === 'brentCrudeShockUsd')!;
  const edited = oil.set!(geo.set!(desk, 0.75), 20);
  assert.equal(edited.isOverridden, true);
  assert.deepEqual(changedAssumptions(desk, edited), ['geopoliticalRiskScore', 'brentCrudeShockUsd']);
  assert.equal(oil.fmt(20), '+$20 a barrel');
  // Figures the full review page cannot change are shown, not editable.
  const spread = APPROVAL_ASSUMPTIONS.find((a) => a.id === 'debtServicingSpreadBps')!;
  assert.equal(spread.edit, undefined);
  assert.equal(spread.fmt(85), '+85 bps');
});
