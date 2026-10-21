"""Private, reviewed WEO evidence bundles; no provider activation or model coupling."""

import hashlib
import json
import math
import uuid

from .storage import Conflict, NotFound, _audit
from .validation import utc_now

CONTRACT = "weo-macro-desk-v1"
RIGHTS_POLICY = "local-research-only-publication-blocked-v1"
WATCHLIST = ("USA", "CHN", "JPN", "DEU", "GBR", "IND", "BRA", "MEX", "ZAF", "TUR", "RUS", "UKR")
INDICATORS = (
    {"code": "NGDP_RPCH", "label": "Real GDP growth", "unit": "% annual change"},
    {"code": "PCPIPCH", "label": "Annual-average CPI inflation", "unit": "% annual change"},
    {"code": "GGXWDG_NGDP", "label": "General government gross debt", "unit": "% of GDP"},
    {"code": "BCA_NGDPD", "label": "Current account balance", "unit": "% of GDP"},
)
INDICATOR_CODES = tuple(i["code"] for i in INDICATORS)
LIMITATIONS = [
    "Local authorized research only. Public display and redistribution rights are unreviewed; publication blocked.",
    "WEO actual history is revisable. Estimates/projections are combined by the provider, not separated by inference.",
    "Annual reporting years may be fiscal years. Different countries can have different latest actual years.",
    "Freshness and historical point-in-time availability are unverified; retrieval is not publication.",
    "Changes are descriptive percentage-point differences, not risk scores, causal effects or model inputs.",
    "Global means the WEO individual-economy catalog, not guaranteed world coverage. No aggregate is computed.",
]


def config():
    return {"contractVersion": CONTRACT, "rightsPolicy": RIGHTS_POLICY, "publicAllowed": False,
            "watchlist": list(WATCHLIST), "indicators": list(INDICATORS), "limitations": LIMITATIONS}


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def read_bundle(row):
    try:
        bundle = json.loads(row["payload"])
        analysis = bundle["analysis"]
        content_digest = digest({k: v for k, v in analysis.items() if k != "digest"})
        valid = (bundle["id"] == row["id"] and bundle["createdAt"] == row["created_at"] and
                 bundle["reviewNote"] == row["review_note"] and analysis["source"]["runId"] == row["weo_run_id"] and
                 analysis["digest"] == row["digest"] == content_digest and analysis["publicAllowed"] is False)
    except (KeyError, TypeError, ValueError):
        raise Conflict("Reviewed bundle integrity check failed") from None
    if not valid:
        raise Conflict("Reviewed bundle integrity check failed")
    return bundle


def metric(rows, series):
    """Require explicit native unit, classification and consecutive comparable actuals."""
    actual = [r for r in rows if r["classification"] == "actual" and r["value"] is not None]
    latest = actual[-1] if actual else None
    previous = next((r for r in rows if latest and r["year"] == latest["year"] - 1), None)
    reason = None
    if not series:
        reason = "Series absent"
    elif series["analysisBlocked"]:
        reason = "Provider blocked analysis: unit, scale or actual-data boundary unverified"
    elif series["unit"] != "PT" or series["scale"] != "0" or series["attributes"].get("FREQUENCY") != "A":
        reason = "Unsupported unit, scale or frequency; requires contract review"
    elif latest is None:
        reason = "No available IMF-classified actual value"
    elif previous is None or previous["value"] is None or previous["classification"] != "actual":
        reason = "Preceding reporting year has no comparable actual value"
    elif any(r["status"] in ("B", "D", "F") for r in (latest, previous)):
        reason = "Source break, definition difference or forecast status"
    else:
        observational = {"OBS_VALUE", "TIME_PERIOD", "STATUS", "OBS_STATUS"}
        definitions = [{k: v for k, v in r["attributes"].items() if k not in observational}
                       for r in (latest, previous)]
        if definitions[0] != definitions[1]:
            reason = "Observation definitions differ"
    change = None if reason else latest["value"] - previous["value"]
    if change is not None and not math.isfinite(change):
        raise Conflict("Non-finite WEO difference; analysis blocked")
    return {"latestActual": latest, "previousActual": previous if previous and previous["classification"] == "actual" else None,
            "changePp": change, "changeBlockedReason": reason,
            "freshness": "unverified",
            "missingActualYears": [r["year"] for r in rows if r["classification"] == "actual" and r["value"] is None]}


class AnalysisStore:
    def __init__(self, store):
        self.store = store

    def _preview(self, conn, run_id):
        run = conn.execute("SELECT * FROM weo_runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            raise NotFound("WEO source snapshot not found")
        report = json.loads(run["report"])
        if (run["status"] not in ("staged", "committed") or report.get("errors") or
                report.get("transportComplete") is not True or report.get("contractVersion") != "weo-annual-native-v1"):
            raise Conflict("Only a completed, validated WEO native-v1 snapshot can be reviewed")
        if conn.execute("SELECT count(*) FROM weo_rows WHERE run_id=?", (run_id,)).fetchone()[0] != report.get("rowCount"):
            raise Conflict("WEO row count does not match its validated report")
        sources = []
        for source in conn.execute(
                "SELECT s.*,o.content,o.size FROM weo_sources s JOIN originals o ON o.sha256=s.sha256 "
                "WHERE run_id=? ORDER BY ordinal", (run_id,)):
            if hashlib.sha256(source["content"]).hexdigest() != source["sha256"]:
                raise Conflict("WEO original checksum mismatch")
            sources.append({"ordinal": source["ordinal"], "path": source["path"], "sha256": source["sha256"],
                            "httpStatus": source["http_status"], "bytes": source["size"]})
        hashes = {s["sha256"] for s in sources}
        if not sources or not report.get("countries"):
            raise Conflict("WEO evidence manifest or country catalog missing")
        catalogs = report["countries"]
        codes = [c["code"] for c in catalogs]
        iso_codes = [c["iso3"] for c in catalogs if c["iso3"] is not None]
        if len(set(codes)) != len(codes) or len(set(iso_codes)) != len(iso_codes):
            raise Conflict("Ambiguous WEO country crosswalk")
        series = {}
        for row in conn.execute(
                "SELECT country,indicator,payload FROM weo_series WHERE run_id=? AND indicator IN (?,?,?,?)",
                (run_id, *INDICATOR_CODES)):
            value = json.loads(row["payload"])
            if value["sourceHash"] not in hashes:
                raise Conflict("WEO series lacks retained source evidence")
            series[(row["country"], row["indicator"])] = value
        observations = {}
        for row in conn.execute(
                "SELECT country,indicator,payload FROM weo_rows WHERE run_id=? AND indicator IN (?,?,?,?) "
                "ORDER BY country,indicator,year", (run_id, *INDICATOR_CODES)):
            value = json.loads(row["payload"])
            if value["sourceHash"] not in hashes:
                raise Conflict("WEO observation lacks retained source evidence")
            observations.setdefault((row["country"], row["indicator"]), []).append(value)
        countries = []
        for country in sorted(catalogs, key=lambda c: c["code"]):
            metrics = []
            for indicator in INDICATORS:
                key = (country["code"], indicator["code"])
                rows, native_series = observations.get(key, []), series.get(key)
                metrics.append({**indicator, "evidenceId": f"{run_id}/{country['code']}/{indicator['code']}",
                                "series": native_series, "rows": rows, **metric(rows, native_series)})
            countries.append({**country, "watchlisted": country["iso3"] in WATCHLIST, "metrics": metrics})
        payload = {**config(), "source": {"provider": "imf-weo", "runId": run_id, "acquisitionStartedAt": run["created_at"],
                                         "retrievedAt": report.get("retrievedAt"),
                                         "publicationDate": report.get("publicationDate"), "sources": sources},
                   "countries": countries, "unmappedWatchlist": sorted(set(WATCHLIST) - set(iso_codes))}
        return {**payload, "digest": digest(payload)}

    def preview(self, run_id):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            try:
                return self._preview(conn, run_id)
            finally:
                conn.rollback()

    def create(self, run_id, expected_digest, review_note):
        with self.store.connection() as conn, self.store.transaction(conn):
            payload = self._preview(conn, run_id)
            if payload["digest"] != expected_digest:
                raise Conflict("Evidence changed since preview; review again before saving")
            bundle = {"id": str(uuid.uuid4()), "createdAt": utc_now(), "reviewNote": review_note, "analysis": payload}
            conn.execute("INSERT INTO analysis_bundles VALUES (?,?,?,?,?,?)",
                         (bundle["id"], bundle["createdAt"], run_id, payload["digest"], review_note,
                          json.dumps(bundle, allow_nan=False)))
            _audit(conn, "analysis_bundle_reviewed", bundleId=bundle["id"], weoRunId=run_id,
                   digest=payload["digest"], rightsPolicy=RIGHTS_POLICY, publicAllowed=False)
            return bundle

    def summaries(self):
        with self.store.connection() as conn:
            return [{"id": r["id"], "createdAt": r["created_at"], "runId": r["weo_run_id"],
                     "digest": r["digest"], "reviewNote": r["review_note"]}
                    for r in conn.execute("SELECT id,created_at,weo_run_id,digest,review_note FROM analysis_bundles ORDER BY created_at,id")]

    def get(self, bundle_id):
        with self.store.connection() as conn:
            row = conn.execute("SELECT * FROM analysis_bundles WHERE id=?", (bundle_id,)).fetchone()
            if not row:
                raise NotFound("Reviewed analysis bundle not found")
            return read_bundle(row)
