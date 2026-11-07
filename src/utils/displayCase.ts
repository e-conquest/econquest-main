/**
 * Design system: sentence case for display. Turns ALL-CAPS labels (often from model output
 * or presets) into sentence case, keeping known acronyms. Mixed-case text is returned as is.
 */
const ACRONYMS = new Set(
  'DSA GDP NSS CDS IC EWS FX IMF WB MPC CPI RV EM NPV CAC LGD VAR XCCY NGFS SLB BEER FEER USD EUR UK US EU AI PDF OLS DMO BCB CBRT SARB BOJ BOE ECB FED PM IG HY OAS ZAR TRY BRL MXN IDR EGP JPY GBP DXY BIS ESG DV01 CS01 YTD IRR SOFR OIS EMBI LNG PPP REER BOP SDR G7 G20 OPEC NATO'.split(' ')
);

export function toDisplayCase(text: string | undefined | null): string {
  if (!text) return '';
  if (/[a-z]/.test(text)) return text;
  let first = true;
  // Data codes such as HY_SPECULATIVE or HOLD_AND_MONITOR read as words.
  return text.replace(/_+/g, ' ').replace(/[A-Za-z0-9][A-Za-z0-9.']*/g, (word) => {
    const out = ACRONYMS.has(word) || /\d/.test(word)
      ? word
      : word === 'BPS'
      ? 'bps'
      : first
      ? word.charAt(0) + word.slice(1).toLowerCase()
      : word.toLowerCase();
    first = false;
    return out;
  });
}
