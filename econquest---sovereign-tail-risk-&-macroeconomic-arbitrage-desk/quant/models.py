"""Firth fitting and numerically stable, causal Gaussian HMM filtering."""

import numpy as np
from scipy.special import expit, logsumexp


def firth_objective(beta: np.ndarray, x: np.ndarray, y: np.ndarray) -> float:
    eta = x @ beta
    probability = expit(eta)
    weights = probability * (1 - probability)
    sign, logdet = np.linalg.slogdet(x.T @ (weights[:, None] * x))
    if sign <= 0:
        return -np.inf
    return float(np.sum(y * eta - np.logaddexp(0, eta)) + 0.5 * logdet)


def fit_firth(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, int]:
    """Jeffreys-penalized logistic regression using adjusted-score iteration."""
    if not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError("Firth inputs must be finite")
    if set(np.unique(y)) != {0, 1}:
        raise ValueError("Firth fitting requires both event and non-event observations")
    if np.linalg.matrix_rank(x) != x.shape[1]:
        raise ValueError("Firth design matrix is rank deficient")
    beta = np.zeros(x.shape[1])
    for iteration in range(1, 501):
        probability = expit(x @ beta)
        weights = probability * (1 - probability)
        information = x.T @ (weights[:, None] * x)
        leverage = weights * np.sum(x * np.linalg.solve(information, x.T).T, axis=1)
        score = x.T @ (y - probability + leverage * (0.5 - probability))
        step = np.linalg.solve(information, score)
        if np.max(np.abs(score)) < 1e-8:
            return beta, iteration
        current = firth_objective(beta, x, y)
        for _ in range(40):
            candidate = beta + step
            if firth_objective(candidate, x, y) >= current - 1e-12:
                break
            step *= 0.5
        else:
            raise RuntimeError("Firth line search failed")
        beta = candidate
        if np.max(np.abs(step)) < 1e-9 and np.max(np.abs(score)) < 1e-6:
            return beta, iteration
    raise RuntimeError("Firth fit did not converge")


def filter_hmm(
    observations: np.ndarray,
    initial: np.ndarray,
    transition: np.ndarray,
    means: np.ndarray,
    variances: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Forward filtering only: future observations never change earlier states."""
    posterior = np.asarray(initial, dtype=float)
    outputs = []
    likelihood = 0.0
    for index, observation in enumerate(observations):
        prior = posterior if index == 0 else posterior @ transition
        emission = -0.5 * np.sum(
            np.log(2 * np.pi * variances) + (observation - means) ** 2 / variances,
            axis=1,
        )
        log_weights = np.log(prior) + emission
        normalizer = logsumexp(log_weights)
        posterior = np.exp(log_weights - normalizer)
        outputs.append(posterior)
        likelihood += float(normalizer)
    return np.array(outputs), likelihood
