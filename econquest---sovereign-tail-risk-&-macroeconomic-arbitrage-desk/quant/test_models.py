"""Synthetic fixtures test numerics only; they are never training observations."""

import unittest

import numpy as np
from hmmlearn.hmm import GaussianHMM
from scipy.special import expit

from models import filter_hmm, firth_objective, fit_firth


class FirthTests(unittest.TestCase):
    def test_complete_separation_has_finite_known_solution(self) -> None:
        x = np.column_stack([np.ones(20), np.repeat([-1.0, 1.0], 10)])
        y = np.repeat([0.0, 1.0], 10)
        beta, iterations = fit_firth(x, y)
        np.testing.assert_allclose(beta, [0, np.log(21)], atol=1e-7)
        self.assertLess(iterations, 500)
        self.assertTrue(np.isfinite(beta).all())

    def test_penalized_likelihood_stationary_at_fit(self) -> None:
        rng = np.random.default_rng(5)
        x = np.column_stack([np.ones(500), rng.normal(size=(500, 2))])
        y = rng.binomial(1, expit(x @ np.array([-1.8, 0.5, -0.8])))
        beta, _ = fit_firth(x, y)
        gradient = []
        for i in range(len(beta)):
            delta = np.eye(len(beta))[i] * 1e-5
            gradient.append(
                (firth_objective(beta + delta, x, y) - firth_objective(beta - delta, x, y))
                / 2e-5
            )
        np.testing.assert_allclose(gradient, 0, atol=1e-5)

    def test_invalid_design_or_missing_events_fail(self) -> None:
        with self.assertRaisesRegex(ValueError, "both event"):
            fit_firth(np.ones((5, 1)), np.zeros(5))
        with self.assertRaisesRegex(ValueError, "rank deficient"):
            fit_firth(np.ones((4, 2)), np.array([0, 1, 0, 1]))


class HmmTests(unittest.TestCase):
    def test_forward_filter_matches_independent_hmmlearn_prefixes(self) -> None:
        initial = np.array([0.6, 0.3, 0.1])
        transition = np.array([[0.9, 0.08, 0.02], [0.1, 0.8, 0.1], [0.05, 0.1, 0.85]])
        means = np.array([[-1.0], [0.0], [2.0]])
        variances = np.array([[0.4], [0.6], [0.9]])
        observations = np.array([[-1.2], [-0.4], [0.6], [2.2]])
        reference = GaussianHMM(n_components=3, covariance_type="diag", init_params="")
        reference.startprob_, reference.transmat_ = initial, transition
        reference.means_, reference.covars_ = means, variances
        filtered, likelihood = filter_hmm(observations, initial, transition, means, variances)
        for end in range(1, len(observations) + 1):
            np.testing.assert_allclose(
                filtered[end - 1], reference.predict_proba(observations[:end])[-1], atol=1e-12
            )
        self.assertAlmostEqual(likelihood, reference.score(observations), places=12)
        np.testing.assert_allclose(filtered.sum(axis=1), 1, atol=1e-12)


if __name__ == "__main__":
    unittest.main()
