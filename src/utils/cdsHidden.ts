/**
 * CDS is hidden for now (Sam, 2026-11-06): no free source publishes it, and the USD bond spread
 * over Treasuries (src/utils/hardCurrencySpread.ts) stands in for it, labelled a bond spread.
 *
 * Hidden, not deleted: the own-data CDS code (src/utils/ownCds.ts: your file or LSEG) is kept and
 * comes back by setting this to false. While it is true the server never reads your CDS feed, and
 * the screens, settings, connection list and council prompts leave CDS out instead of showing
 * "5Y CDS: Missing".
 */
export const CDS_HIDDEN = true;
