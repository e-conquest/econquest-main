# UCDP datasets (26.1 release)

Downloaded unchanged from https://ucdp.uu.se/downloads/ on 2026-11-06 and shipped with the app, so
the conflict figures work without any setup. Read by `src/utils/ucdpStore.ts`.

| File | Dataset |
| --- | --- |
| `ucdp-prio-acd-261-csv.zip` | UCDP/PRIO Armed Conflict Dataset 26.1 (1946-2025) |
| `ucdp-brd-conf-261-csv.zip` | UCDP Battle-Related Deaths, conflict level, 26.1 (1989-2025) |
| `ucdp-nonstate-261-csv.zip` | UCDP Non-State Conflict 26.1 (1989-2025) |
| `ucdp-onesided-261-csv.zip` | UCDP One-Sided Violence 26.1 (1989-2025) |
| `ucdp-dyadic-261-csv.zip` | UCDP Dyadic Dataset 26.1 (1946-2025) |

**Licence:** CC BY 4.0. "All datasets are free of charge and licensed under CC BY 4.0 — you are free to
use and redistribute them provided you cite the relevant publications listed with each dataset."

**Cite:** Davies, Shawn, Therése Pettersson & Magnus Öberg (2026), "Organized violence 1989–2025, and
violent political protests", *Journal of Peace Research*; Gleditsch, Nils Petter et al. (2002), "Armed
Conflict 1946–2001: A New Dataset", *Journal of Peace Research* 39(5). UCDP is part of and funded by
DEMSCORE, national research infrastructure grant 2021-00162 from the Swedish Research Council.

**Updating:** when UCDP publishes 27.1 (usually in the spring), download the same five CSV zips and
either replace these files or put them in `data/local/ucdp/`. Files in `data/local/ucdp/` are read too,
and a newer release of a dataset wins over an older one.
