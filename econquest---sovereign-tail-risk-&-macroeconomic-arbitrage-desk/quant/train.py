"""Train on observed annual data and export auditable browser inference artifacts."""

import hashlib
import importlib.metadata
import json
import platform
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from lightgbm import LGBMClassifier
from scipy.special import expit
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

from data import DATA, FEATURES, ROOT
from models import filter_hmm, fit_firth

NAMES = list(FEATURES)
SCALES = np.array([100.0, 100.0, 6.0, 5.0, 10.0, 5.0])
HMM_COLUMNS = [2, 3, 4]
COUNTRIES = ["CHL", "BLZ", "LKA", "ARG", "TUR", "GHA", "IDN", "PAK", "ZAF"]


def metrics(y: np.ndarray, probability: np.ndarray) -> dict:
    return {
        "rows": len(y),
        "events": int(y.sum()),
        "brier": float(brier_score_loss(y, probability)),
        "logLoss": float(log_loss(y, probability, labels=[0, 1])),
        "rocAuc": float(roc_auc_score(y, probability)),
        "averagePrecision": float(average_precision_score(y, probability)),
    }


def sequences(panel: pd.DataFrame) -> list[pd.DataFrame]:
    """Split on both country boundaries and missing calendar years."""
    valid = panel.dropna(subset=[NAMES[i] for i in HMM_COLUMNS])
    result = []
    for _, country in valid.groupby("country", sort=True):
        runs = country["year"].diff().ne(1).cumsum()
        result.extend(group for _, group in country.groupby(runs) if len(group) >= 2)
    return result


def train() -> None:
    panel_path = DATA / "observed-panel.csv"
    panel = pd.read_csv(panel_path).sort_values(["country", "year"])
    if panel.duplicated(["country", "year"]).any():
        raise ValueError("Duplicate country/year records")
    if not panel["year"].between(1980, 2024).all():
        raise ValueError("Unexpected observation year")
    values = panel[list(FEATURES)].to_numpy(dtype=float)
    if np.isinf(values).any():
        raise ValueError("Non-finite observed features")
    if panel["defaultDebtUsdMillions"].isna().any() or (panel["defaultDebtUsdMillions"] < 0).any():
        raise ValueError("Missing or negative default-debt labels")
    panel["nextYear"] = panel.groupby("country")["year"].shift(-1)
    panel["nextDefaultDebt"] = panel.groupby("country")["defaultDebtUsdMillions"].shift(-1)
    # A discrete-time onset hazard is defined only while the country is not in default.
    risk = panel.loc[
        panel["defaultDebtUsdMillions"].eq(0)
        & panel["nextYear"].eq(panel["year"] + 1)
        & panel["nextDefaultDebt"].notna()
        & panel[NAMES].notna().sum(axis=1).ge(4)
    ].copy()
    risk["outcome"] = (risk["nextDefaultDebt"] > 0).astype(int)
    # Label year t+1 must precede the next split's predictor years (one-year embargo).
    training = risk.loc[risk["year"] <= 2012]
    validation = risk.loc[risk["year"].between(2014, 2017)]
    testing = risk.loc[risk["year"].between(2019, 2023)]
    for name, subset in [("train", training), ("validation", validation), ("test", testing)]:
        if len(subset) < 50 or subset["outcome"].sum() < 5 or subset["outcome"].nunique() != 2:
            raise ValueError(f"Insufficient events or rows in {name}")

    medians = training[NAMES].median().to_numpy()
    transformed = np.arcsinh(training[NAMES].fillna(dict(zip(NAMES, medians))).to_numpy() / SCALES)
    center, scale = transformed.mean(axis=0), transformed.std(axis=0)
    if not np.isfinite(medians).all() or (scale < 1e-10).any():
        raise ValueError("Invalid training preprocessor")

    def preprocess(frame: pd.DataFrame) -> np.ndarray:
        values = frame[NAMES].to_numpy(dtype=float)
        filled = np.where(np.isnan(values), medians, values)
        return (np.arcsinh(filled / SCALES) - center) / scale

    x_train = preprocess(training)
    y_train = training["outcome"].to_numpy()
    beta, iterations = fit_firth(np.column_stack([np.ones(len(training)), x_train]), y_train)
    challenger = LGBMClassifier(
        n_estimators=100,
        learning_rate=0.03,
        num_leaves=7,
        max_depth=3,
        min_child_samples=30,
        reg_lambda=2.0,
        monotone_constraints=[1, 1, -1, -1, 1, -1],
        random_state=1729,
        n_jobs=1,
        deterministic=True,
        force_col_wise=True,
        verbosity=-1,
    ).fit(x_train, y_train)

    def hazard_predictions(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        x = preprocess(frame)
        firth = expit(np.column_stack([np.ones(len(frame)), x]) @ beta)
        return firth, challenger.booster_.predict(x)

    v_firth, v_lightgbm = hazard_predictions(validation)
    v_y = validation["outcome"].to_numpy()
    # Weight selection uses validation only, never the held-out test outcomes.
    weights = np.linspace(0, 1, 101)
    weight = float(min(
        weights,
        key=lambda w: log_loss(v_y, (1 - w) * v_firth + w * v_lightgbm),
    ))
    t_firth, t_lightgbm = hazard_predictions(testing)
    t_y = testing["outcome"].to_numpy()

    hmm_sequences = sequences(panel.loc[panel["year"] <= 2017])
    hmm_values = np.concatenate([
        np.arcsinh(frame[NAMES].to_numpy()[:, HMM_COLUMNS] / SCALES[HMM_COLUMNS])
        for frame in hmm_sequences
    ])
    hmm_center, hmm_scale = hmm_values.mean(axis=0), hmm_values.std(axis=0)
    hmm_x = (hmm_values - hmm_center) / hmm_scale
    lengths = [len(frame) for frame in hmm_sequences]
    candidates = []
    for seed in [11, 29, 47, 71, 97]:
        model = GaussianHMM(
            n_components=3,
            covariance_type="diag",
            n_iter=500,
            tol=1e-5,
            min_covar=1e-3,
            random_state=seed,
        ).fit(hmm_x, lengths)
        history = list(model.monitor_.history)
        if (
            len(history) >= 2
            and abs(history[-1] - history[-2]) < model.tol
            and np.all(model._covars_ > 0)
            and np.all(model.startprob_ > 0)
            and np.all(model.transmat_ > 0)
        ):
            candidates.append((model.score(hmm_x, lengths), model))
    if not candidates:
        raise RuntimeError("No HMM initialization converged")
    hmm_score, hmm = max(candidates, key=lambda item: item[0])
    # Names are interpretations of fitted emissions, not posterior threshold rules.
    stress = -hmm.means_[:, 0] - hmm.means_[:, 1] + hmm.means_[:, 2]
    order = np.argsort(stress)
    initial = hmm.startprob_[order]
    transition = hmm.transmat_[order][:, order]
    means = hmm.means_[order]
    variances = hmm._covars_[order]
    hmm_test_sequences = sequences(panel.loc[panel["year"].between(2019, 2024)])
    heldout_likelihood = 0.0
    heldout_count = 0
    for frame in hmm_test_sequences:
        x = (
            np.arcsinh(frame[NAMES].to_numpy()[:, HMM_COLUMNS] / SCALES[HMM_COLUMNS])
            - hmm_center
        ) / hmm_scale
        _, score = filter_hmm(x, initial, transition, means, variances)
        heldout_likelihood += score
        heldout_count += len(frame)

    country_histories = {}
    for code in COUNTRIES:
        available = sequences(panel.loc[panel["country"] == code])
        if not available:
            raise ValueError(f"No usable observed sequence for {code}")
        latest = max(available, key=lambda frame: frame["year"].max())
        if int(latest["year"].max()) < 2022:
            raise ValueError(f"Stale observation sequence for {code}")
        country_histories[code] = [
            {
                "year": int(row["year"]),
                "values": [None if pd.isna(row[name]) else float(row[name]) for name in NAMES],
                "inDefault": bool(row["defaultDebtUsdMillions"] > 0),
            }
            for _, row in latest.iterrows()
        ]

    manifest = json.loads((DATA / "sources.json").read_text())
    panel_hash = hashlib.sha256(panel_path.read_bytes()).hexdigest()
    if manifest["panelSha256"] != panel_hash:
        raise ValueError("Panel checksum does not match source manifest")
    artifact = {
        "schemaVersion": 1,
        "modelVersion": f"annual-macro-v1-{panel_hash[:12]}",
        "status": "research-only",
        "deploymentWarning": "Held-out hazard performance does not beat the constant-rate baseline; not approved for trading or credit decisions.",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "dataSha256": panel_hash,
        "features": NAMES,
        "indicators": FEATURES,
        "preprocessing": {
            "medians": medians.tolist(),
            "asinhScales": SCALES.tolist(),
            "center": center.tolist(),
            "scale": scale.tolist(),
        },
        "hazard": {
            "target": "Next-year entry into positive BoC-BoE total debt in default, conditional on no current default",
            "trainingPredictorYears": [int(training.year.min()), 2012],
            "validationPredictorYears": [2014, 2017],
            "testPredictorYears": [2019, 2023],
            "trainingRows": len(training),
            "trainingEvents": int(y_train.sum()),
            "firth": {"coefficients": beta.tolist(), "iterations": iterations},
            "lightgbm": {
                "trees": [tree["tree_structure"] for tree in challenger.booster_.dump_model()["tree_info"]],
                "monotoneConstraints": [1, 1, -1, -1, 1, -1],
            },
            "lightgbmWeight": weight,
            "validation": {
                "firth": metrics(v_y, v_firth),
                "lightgbm": metrics(v_y, v_lightgbm),
                "blend": metrics(v_y, (1 - weight) * v_firth + weight * v_lightgbm),
            },
            "test": {
                "firth": metrics(t_y, t_firth),
                "lightgbm": metrics(t_y, t_lightgbm),
                "blend": metrics(t_y, (1 - weight) * t_firth + weight * t_lightgbm),
                "constantTrainingRate": metrics(t_y, np.full(len(t_y), y_train.mean())),
            },
        },
        "hmm": {
            "featureIndices": HMM_COLUMNS,
            "center": hmm_center.tolist(),
            "scale": hmm_scale.tolist(),
            "states": ["Calm", "Stressed", "Crisis"],
            "initial": initial.tolist(),
            "transition": transition.tolist(),
            "means": means.tolist(),
            "variances": variances.tolist(),
            "trainingThrough": 2017,
            "trainingSequences": len(lengths),
            "trainingObservations": len(hmm_x),
            "trainingLogLikelihood": float(hmm_score),
            "iterations": hmm.monitor_.iter,
            "testObservations": heldout_count,
            "testLogLikelihoodPerObservation": heldout_likelihood / heldout_count,
        },
        "countries": country_histories,
        "sources": manifest,
        "software": {
            "python": platform.python_version(),
            **{name: importlib.metadata.version(name) for name in [
                "numpy", "scipy", "pandas", "scikit-learn", "lightgbm", "hmmlearn",
            ]},
        },
    }
    output = ROOT / "src" / "data" / "fittedAnnualModels.json"
    output.write_text(json.dumps(artifact, separators=(",", ":"), allow_nan=False) + "\n")
    historical_evaluation = {
        "schemaVersion": 1,
        "modelVersion": artifact["modelVersion"],
        "dataSha256": panel_hash,
        "constantTrainingRate": float(y_train.mean()),
        "rows": [
            {
                "country": row["country"],
                "predictorYear": int(row["year"]),
                "outcomeYear": int(row["year"] + 1),
                "outcome": int(row["outcome"]),
                "values": [None if pd.isna(row[name]) else float(row[name]) for name in NAMES],
            }
            for _, row in testing.iterrows()
        ],
    }
    (ROOT / "src" / "data" / "historicalEvaluation.json").write_text(
        json.dumps(historical_evaluation, separators=(",", ":"), allow_nan=False) + "\n"
    )

    # Independent Python references exercise tree export and forward-filter parity.
    references = []
    for code, observations in country_histories.items():
        frame = pd.DataFrame([dict(zip(NAMES, row["values"])) for row in observations])
        f, l = hazard_predictions(frame.tail(1))
        hmm_observations = (
            np.arcsinh(frame.to_numpy(dtype=float)[:, HMM_COLUMNS] / SCALES[HMM_COLUMNS])
            - hmm_center
        ) / hmm_scale
        probabilities, _ = filter_hmm(hmm_observations, initial, transition, means, variances)
        references.append({
            "country": code, "firth": float(f[0]), "lightgbm": float(l[0]),
            "regimeProbabilities": probabilities[-1].tolist(),
        })
    (ROOT / "quant" / "inference-reference.json").write_text(json.dumps(references, indent=2) + "\n")
    print(json.dumps({
        "version": artifact["modelVersion"],
        "trainingRows": len(training), "trainingEvents": int(y_train.sum()),
        "lightgbmWeight": weight, "heldOutTest": artifact["hazard"]["test"],
        "hmmSequences": len(lengths), "hmmObservations": len(hmm_x),
        "countryVintages": {code: rows[-1]["year"] for code, rows in country_histories.items()},
    }, indent=2))


if __name__ == "__main__":
    train()
