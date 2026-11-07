/**
 * Replication pack (seven-groups plan, Phase 5, teaching): a Chart Agent result as a zip of the
 * data it drew (data.csv), the same tests written out in Python, R and Stata (replicate.py,
 * replicate.R, replicate.do) with the settings the app used, and a README with what each column
 * is, its source and credit, and the app's own figures to check against.
 *
 * The scripts do the arithmetic by hand (OLS, the Granger F test, the ADF regression with its lag
 * chosen by AIC on one sample, the HP filter as a linear solve), so they match src/utils/stats.ts
 * rather than a package's defaults. Browser-safe, pure apart from the zip.
 */
import { strToU8, zipSync } from 'fflate';
import type { ChartLine, ChartResult, ChartTest } from './councilChart';
import { MAX_SAVED_POINTS } from './councilChart';
import { creditsFor } from './creditLines';
import { EXPORT_NOTICE } from './disclaimer';
import { hpLambda, periodsPerYear, TRANSFORM_LABEL, type Freq } from './stats';

/** Tests the scripts write out for a chart over time; across countries only these two run. */
const TIME_TESTS: ChartTest[] = ['summary', 'correlation', 'regression', 'leadlag', 'granger', 'rolling', 'adf', 'hp'];
const CROSS_TESTS: ChartTest[] = ['correlation', 'regression'];

export interface PackSettings {
  /** Rows where both of the first two columns have a value. */
  pairs: number;
  leadLagMax: number;
  grangerLags: number;
  rollingWindow: number;
  /** Largest ADF lag tried, per column (by the column's own count of values). */
  adfTop: Record<string, number>;
  hpLambda: number;
}

export interface ReplicationPack {
  files: Record<string, string>;
  settings: PackSettings | null;
  /** Tests the scripts run, in the app's order. */
  tests: ChartTest[];
}

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const num = (v: number) => (Number.isFinite(v) ? String(v) : '');
const q = (s: string) => JSON.stringify(s);

/** The lines the scripts read: the chart's own, without trend lines the app added for the HP test. */
export function packLines(result: ChartResult): ChartLine[] {
  return result.lines.filter((l) => !l.key.endsWith('_trend'));
}

/** The settings the app's tests use (src/utils/councilChart.ts computeChart), from the data in the pack. */
export function packSettings(result: ChartResult): PackSettings {
  const lines = packLines(result);
  const freq = result.freq as Freq;
  const ppy = periodsPerYear(freq);
  let pairs = 0;
  if (lines.length >= 2) {
    const b = new Set(lines[1].points.filter((p) => Number.isFinite(p.value)).map((p) => p.date));
    pairs = lines[0].points.filter((p) => Number.isFinite(p.value) && b.has(p.date)).length;
  }
  const adfTop: Record<string, number> = {};
  for (const l of lines.slice(0, 2)) {
    const N = l.points.filter((p) => Number.isFinite(p.value)).length;
    adfTop[l.key] = Math.max(0, Math.min(Math.floor(12 * (N / 100) ** 0.25), Math.floor(N / 4)));
  }
  return {
    pairs,
    leadLagMax: Math.max(1, Math.min(Math.round(ppy * 1.5), Math.floor(pairs / 4))),
    grangerLags: Math.max(1, Math.min(ppy >= 12 ? 6 : ppy >= 4 ? 4 : 2, Math.floor((pairs - 10) / 3))),
    rollingWindow: Math.max(8, Math.min(ppy * 3, Math.floor(pairs / 3))),
    adfTop,
    hpLambda: hpLambda(freq),
  };
}

function dataCsv(result: ChartResult): string {
  if (!result.lines.length && result.scatter) {
    return ['country,x,y', ...result.scatter.pairs.map((p) => [esc(p.date), num(p.x), num(p.y)].join(','))].join('\n') + '\n';
  }
  const lines = packLines(result);
  const byDate = new Map<string, Map<string, number>>();
  for (const l of lines)
    for (const p of l.points) {
      if (!byDate.has(p.date)) byDate.set(p.date, new Map());
      byDate.get(p.date)!.set(l.key, p.value);
    }
  const dates = [...byDate.keys()].sort();
  return ['date,' + lines.map((l) => l.key).join(','), ...dates.map((d) => [d, ...lines.map((l) => num(byDate.get(d)!.get(l.key) ?? NaN))].join(','))].join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Python

function python(result: ChartResult, tests: ChartTest[], s: PackSettings | null, cols: string[]): string {
  const has = (t: ChartTest) => tests.includes(t);
  const out: string[] = [
    `# Replication of the econquest Chart Agent result: ${result.title}`,
    '# Needs Python 3 with numpy, pandas and scipy. Run from this folder: python replicate.py',
    'import numpy as np',
    'import pandas as pd',
    'from scipy import stats',
    '',
    "df = pd.read_csv('data.csv')",
    '',
    'def ols(y, X):',
    '    """OLS of y on the columns of X with an intercept, as src/utils/stats.ts ols()."""',
    '    y = np.asarray(y, float)',
    '    Z = np.column_stack([np.ones(len(y)), np.asarray(X, float).reshape(len(y), -1)])',
    '    inv = np.linalg.inv(Z.T @ Z)',
    '    b = inv @ Z.T @ y',
    '    e = y - Z @ b',
    '    rss = float(e @ e)',
    '    dof = len(y) - Z.shape[1]',
    '    se = np.sqrt(np.diag(inv) * rss / dof)',
    '    t = b / se',
    '    p = 2 * stats.t.sf(np.abs(t), dof)',
    '    r2 = 1 - rss / float(((y - y.mean()) ** 2).sum())',
    "    return dict(b=b, se=se, t=t, p=p, rss=rss, n=len(y), k=Z.shape[1], r2=r2, e=e)",
    '',
  ];
  if (!s) {
    out.push(
      "x, y = df['x'].to_numpy(float), df['y'].to_numpy(float)",
      ...(has('correlation') ? ['', 'r, p = stats.pearsonr(x, y)', "print(f'Correlation across countries: r = {r:.2f}, p = {p:.3f}, {len(x)} countries')"] : []),
      ...(has('regression')
        ? [
            '',
            'm = ols(y, x)',
            "print(f\"Regression across countries: slope {m['b'][1]:.4g}, intercept {m['b'][0]:.4g}, t = {m['t'][1]:.2f}, R2 = {m['r2']:.2f}, {m['n']} countries\")",
            "order = np.argsort(m['e'])",
            "print('Furthest above the line:', df['country'].iloc[order[-1]], '; furthest below:', df['country'].iloc[order[0]])",
          ]
        : [])
    );
    return out.join('\n') + '\n';
  }
  const [a, b] = cols;
  out.push(`A, B = ${q(a)}, ${q(b ?? '')}`);
  if (b) out.push("pairs = df[['date', A, B]].dropna().reset_index(drop=True)", 'x, y = pairs[A].to_numpy(float), pairs[B].to_numpy(float)', "print(f'{len(x)} rows where both {A} and {B} have a value')");
  if (has('summary'))
    out.push(
      '',
      '# Where it stands (the first column)',
      'v = df[A].dropna().to_numpy(float)',
      "print(f'{A}: latest {v[-1]:.4g}, average {v.mean():.4g}, lowest {v.min():.4g}, highest {v.max():.4g}, {round(100 * (v < v[-1]).mean())}% of points below the latest')"
    );
  if (b && has('correlation')) out.push('', 'r, p = stats.pearsonr(x, y)', "print(f'Correlation: r = {r:.2f}, p = {p:.3f}')");
  if (b && has('regression')) out.push('', 'm = ols(y, x)', "print(f\"Regression of {B} on {A}: slope {m['b'][1]:.4g}, intercept {m['b'][0]:.4g}, t = {m['t'][1]:.2f}, R2 = {m['r2']:.2f}\")");
  if (b && has('leadlag'))
    out.push(
      '',
      `# Lead/lag: lag k > 0 pairs ${a} k rows earlier with ${b} (${a} moves first)`,
      `MAXLAG = ${s.leadLagMax}`,
      'cc = []',
      'for k in range(-MAXLAG, MAXLAG + 1):',
      '    xs = x[:len(x) - k] if k >= 0 else x[-k:]',
      '    ys = y[k:] if k >= 0 else y[:len(y) + k]',
      '    if len(xs) >= 3 and xs.std() > 0 and ys.std() > 0:',
      '        cc.append((k, stats.pearsonr(xs, ys)[0]))',
      'best = max(cc, key=lambda c: abs(c[1]))',
      "print(f'Lead/lag: best lag {best[0]}, r = {best[1]:.2f}')"
    );
  if (b && has('granger'))
    out.push(
      '',
      `LAGS = ${s.grangerLags}`,
      'def granger(src, dst, L):',
      '    """Does src\'s past help predict dst beyond dst\'s own past? F test on the added lags."""',
      '    T = len(dst)',
      '    yv = dst[L:]',
      '    own = np.column_stack([dst[L - j - 1:T - j - 1] for j in range(L)])',
      '    other = np.column_stack([src[L - j - 1:T - j - 1] for j in range(L)])',
      '    r, u = ols(yv, own), ols(yv, np.column_stack([own, other]))',
      "    d2 = u['n'] - u['k']",
      "    f = ((r['rss'] - u['rss']) / L) / (u['rss'] / d2)",
      '    return f, stats.f.sf(f, L, d2)',
      'f, p = granger(x, y, LAGS)',
      'fb, pb = granger(y, x, LAGS)',
      "print(f'Granger, {A} -> {B}: F = {f:.2f}, p = {p:.3f}; {B} -> {A}: p = {pb:.3f} ({LAGS} lags)')"
    );
  if (b && has('rolling'))
    out.push(
      '',
      `W = ${s.rollingWindow}`,
      'roll = [stats.pearsonr(x[i - W + 1:i + 1], y[i - W + 1:i + 1])[0] for i in range(W - 1, len(x))]',
      "print(f'Rolling correlation ({W} rows): lowest {min(roll):.2f}, highest {max(roll):.2f}, latest {roll[-1]:.2f}')"
    );
  if (has('adf'))
    out.push(
      '',
      'def adf(v, top):',
      '    """ADF with a constant; lags 0..top on one sample, chosen by AIC; MacKinnon (2010) 5% critical value."""',
      '    dy = np.diff(v)',
      '    best = None',
      '    for p in range(top + 1):',
      '        rows = range(top, len(dy))',
      '        X = [[v[t]] + [dy[t - j] for j in range(1, p + 1)] for t in rows]',
      '        m = ols([dy[t] for t in rows], X)',
      "        aic = m['n'] * np.log(m['rss'] / m['n']) + 2 * m['k']",
      '        if best is None or aic < best[0]:',
      '            best = (aic, m, p)',
      '    _, m, p = best',
      "    T = m['n']",
      '    crit5 = -2.86154 - 2.8903 / T - 4.234 / T ** 2',
      "    return m['t'][1], crit5, p, T",
      ...cols.slice(0, 2).map((c) => [`stat, crit, p, n = adf(df[${q(c)}].dropna().to_numpy(float), ${s.adfTop[c] ?? 0})`, `print(f'ADF, ${c}: statistic {stat:.2f}, 5% critical value {crit:.2f}, {p} lag(s), {n} points')`].join('\n'))
    );
  if (has('hp'))
    out.push(
      '',
      `LAMBDA = ${s.hpLambda}`,
      'v = df[A].dropna().to_numpy(float)',
      'n = len(v)',
      'D = np.diff(np.eye(n), 2, axis=0)',
      'trend = np.linalg.solve(np.eye(n) + LAMBDA * D.T @ D, v)',
      "print(f'HP filter on {A}: gap from trend at the last point {v[-1] - trend[-1]:.4g}, trend {trend[-1]:.4g} (lambda {LAMBDA})')"
    );
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// R

function rScript(result: ChartResult, tests: ChartTest[], s: PackSettings | null, cols: string[]): string {
  const has = (t: ChartTest) => tests.includes(t);
  const out: string[] = [
    `# Replication of the econquest Chart Agent result: ${result.title}`,
    '# Base R only. Run from this folder: Rscript replicate.R',
    'df <- read.csv("data.csv", stringsAsFactors = FALSE)',
    '',
  ];
  if (!s) {
    if (has('correlation')) out.push('print(cor.test(df$x, df$y))');
    if (has('regression')) out.push('m <- lm(y ~ x, data = df)', 'print(summary(m))', 'cat("Furthest above the line:", df$country[which.max(resid(m))], "; furthest below:", df$country[which.min(resid(m))], "\\n")');
    return out.join('\n') + '\n';
  }
  const [a, b] = cols;
  out.push(`A <- ${q(a)}`, `B <- ${q(b ?? '')}`);
  if (b) out.push('pairs <- df[!is.na(df[[A]]) & !is.na(df[[B]]), ]', 'x <- pairs[[A]]', 'y <- pairs[[B]]', 'cat(length(x), "rows where both have a value\\n")');
  if (has('summary')) out.push('', 'v <- na.omit(df[[A]])', 'cat(A, ": latest", tail(v, 1), "average", mean(v), "lowest", min(v), "highest", max(v), "share below latest", round(100 * mean(v < tail(v, 1))), "%\\n")');
  if (b && has('correlation')) out.push('', 'print(cor.test(x, y))');
  if (b && has('regression')) out.push('', 'print(summary(lm(y ~ x)))');
  if (b && has('leadlag'))
    out.push(
      '',
      `# Lead/lag: lag k > 0 pairs ${a} k rows earlier with ${b}`,
      `MAXLAG <- ${s.leadLagMax}`,
      'n <- length(x)',
      'cc <- sapply(-MAXLAG:MAXLAG, function(k) if (k >= 0) cor(x[1:(n - k)], y[(1 + k):n]) else cor(x[(1 - k):n], y[1:(n + k)]))',
      'names(cc) <- -MAXLAG:MAXLAG',
      'print(round(cc, 3))',
      'cat("Best lag", names(cc)[which.max(abs(cc))], "\\n")'
    );
  if (b && has('granger'))
    out.push(
      '',
      `LAGS <- ${s.grangerLags}`,
      'lagm <- function(v, L) sapply(1:L, function(j) v[(L - j + 1):(length(v) - j)])',
      'granger <- function(src, dst, L) {',
      '  yv <- dst[(L + 1):length(dst)]',
      '  own <- lagm(dst, L); other <- lagm(src, L)',
      '  anova(lm(yv ~ own), lm(yv ~ own + other))',
      '}',
      'print(granger(x, y, LAGS))',
      'print(granger(y, x, LAGS))'
    );
  if (b && has('rolling'))
    out.push('', `W <- ${s.rollingWindow}`, 'roll <- sapply(W:length(x), function(i) cor(x[(i - W + 1):i], y[(i - W + 1):i]))', 'cat("Rolling correlation: lowest", min(roll), "highest", max(roll), "latest", tail(roll, 1), "\\n")');
  if (has('adf'))
    out.push(
      '',
      'adf <- function(v, top) {',
      '  dy <- diff(v); rows <- (top + 1):length(dy); best <- NULL',
      '  for (p in 0:top) {',
      '    X <- cbind(v[rows], if (p > 0) sapply(1:p, function(j) dy[rows - j]) else NULL)',
      '    m <- lm(dy[rows] ~ X)',
      '    n <- length(rows); aic <- n * log(sum(resid(m)^2) / n) + 2 * (ncol(X) + 1)',
      '    if (is.null(best) || aic < best$aic) best <- list(aic = aic, m = m, p = p, n = n)',
      '  }',
      '  T <- best$n',
      '  c(stat = summary(best$m)$coefficients[2, 3], crit5 = -2.86154 - 2.8903 / T - 4.234 / T^2, lags = best$p, n = T)',
      '}',
      ...cols.slice(0, 2).map((c) => `print(adf(na.omit(df[[${q(c)}]]), ${s.adfTop[c] ?? 0}))`)
    );
  if (has('hp'))
    out.push(
      '',
      `LAMBDA <- ${s.hpLambda}`,
      'v <- as.numeric(na.omit(df[[A]])); n <- length(v)',
      'D <- diff(diag(n), differences = 2)',
      'trend <- solve(diag(n) + LAMBDA * crossprod(D), v)',
      'cat("HP gap at the last point", tail(v - trend, 1), "trend", tail(trend, 1), "\\n")'
    );
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Stata

function stata(result: ChartResult, tests: ChartTest[], s: PackSettings | null, cols: string[]): string {
  const has = (t: ChartTest) => tests.includes(t);
  const out: string[] = [`* Replication of the econquest Chart Agent result: ${result.title.replace(/[\r\n]/g, ' ')}`, '* Run from this folder: do replicate.do', 'clear all', 'import delimited using "data.csv", varnames(1) clear', ''];
  if (!s) {
    if (has('correlation')) out.push('pwcorr x y, sig obs');
    if (has('regression')) out.push('regress y x', 'predict e, residuals', 'gsort -e', 'display "Furthest above the line: " country[1]', 'gsort e', 'display "Furthest below the line: " country[1]');
    return out.join('\n') + '\n';
  }
  const [a, b] = cols;
  if (has('summary')) out.push('* Where it stands (the first column)', `preserve`, `keep if !missing(${a})`, `summarize ${a}`, `display "Latest: " ${a}[_N]`, `count if ${a} < ${a}[_N]`, `display "Share below the latest: " round(100 * r(N) / _N) "%"`, 'restore', '');
  if (has('adf'))
    for (const c of cols.slice(0, 2)) {
      const top = s.adfTop[c] ?? 0;
      out.push(
        `* ADF on ${c}: constant, lags 0-${top} on one sample, chosen by AIC (dfuller uses a longer sample for short lags, so the regression is written out)`,
        'preserve',
        `keep if !missing(${c})`,
        'gen t = _n',
        'tsset t',
        'scalar bestaic = .',
        `forvalues p = 0/${top} {`,
        '  local L ""',
        `  if \`p' > 0 local L "L(1/\`p')D.${c}"`,
        `  quietly regress D.${c} L.${c} \`L' if t >= ${top + 2}`,
        '  scalar aic = e(N) * ln(e(rss) / e(N)) + 2 * (e(df_m) + 1)',
        '  if missing(scalar(bestaic)) | scalar(aic) < scalar(bestaic) {',
        '    scalar bestaic = aic',
        `    scalar stat = _b[L.${c}] / _se[L.${c}]`,
        '    scalar lags = `p\'',
        '    scalar T = e(N)',
        '  }',
        '}',
        `display "ADF, ${c}: statistic " scalar(stat) ", 5% critical value " (-2.86154 - 2.8903 / scalar(T) - 4.234 / scalar(T)^2) ", " scalar(lags) " lag(s), " scalar(T) " points"`,
        'restore',
        ''
      );
    }
  if (has('hp')) out.push('preserve', `keep if !missing(${a})`, 'gen t = _n', 'tsset t', `tsfilter hp hpgap = ${a}, smooth(${s.hpLambda}) trend(hptrend)`, 'display "HP gap at the last point: " hpgap[_N] ", trend " hptrend[_N]', 'restore', '');
  if (b) {
    out.push(`keep if !missing(${a}) & !missing(${b})`, 'gen t = _n', 'tsset t', '');
    if (has('correlation')) out.push(`pwcorr ${a} ${b}, sig obs`);
    if (has('regression')) out.push(`regress ${b} ${a}`);
    if (has('leadlag'))
      out.push(
        `* Lead/lag: lag k > 0 pairs ${a} k rows earlier with ${b}`,
        `forvalues k = -${s.leadLagMax}/${s.leadLagMax} {`,
        `  if \`k' >= 0 quietly correlate ${b} L\`k'.${a}`,
        `  else quietly correlate ${b} F\`=-\`k''.${a}`,
        `  display "lag \`k': r = " %6.3f r(rho)`,
        '}'
      );
    if (has('granger')) {
      const L = s.grangerLags;
      out.push(`quietly regress ${b} L(1/${L}).${b} L(1/${L}).${a}`, `testparm L(1/${L}).${a}`, `quietly regress ${a} L(1/${L}).${a} L(1/${L}).${b}`, `testparm L(1/${L}).${b}`);
    }
    if (has('rolling'))
      out.push(
        `local W = ${s.rollingWindow}`,
        'gen roll = .',
        'forvalues i = `W\'/`=_N\' {',
        `  quietly correlate ${a} ${b} if inrange(t, \`i' - \`W' + 1, \`i')`,
        '  quietly replace roll = r(rho) in `i\'',
        '}',
        'summarize roll',
        'display "Latest rolling correlation: " roll[_N]'
      );
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// README

function readme(result: ChartResult, tests: ChartTest[], s: PackSettings | null, now: Date): string {
  const lines = packLines(result);
  const cross = !result.lines.length && Boolean(result.scatter);
  const sources = cross ? result.sources ?? [] : lines.map((l) => l.source);
  const credits = creditsFor(sources).credits;
  const trimmed = lines.some((l) => l.points.length >= MAX_SAVED_POINTS);
  const md: string[] = [
    `# Replication pack: ${result.title}`,
    '',
    `Made by econquest on ${now.toISOString().slice(0, 10)} from a Chart Agent result. ${cross ? 'One point per country, at its latest figure.' : `${result.freq} data, ${TRANSFORM_LABEL[result.transform].toLowerCase()}, ${result.first ?? '?'} to ${result.last ?? '?'}.`}`,
    '',
    '## Files',
    '',
    '- `data.csv`: the figures the chart drew' + (cross ? ' (country, x, y).' : ', one row per date, one column per line (blank where a line has no value).'),
    '- `replicate.py` (numpy, pandas, scipy), `replicate.R` (base R), `replicate.do` (Stata): the same tests with the settings the app used. Run each from this folder.',
    '',
    '## Columns',
    '',
  ];
  if (cross && result.scatter) md.push(`- \`x\`: ${result.scatter.xLabel}`, `- \`y\`: ${result.scatter.yLabel}`, `- Sources: ${sources.join('; ') || 'not given'}`);
  else for (const l of lines) md.push(`- \`${l.key}\`: ${l.label} (${l.unit}). Source: ${l.source}.`);
  md.push('', '## Settings', '');
  if (s) {
    md.push(
      `- Tests on two series use the first two columns (\`${lines[0]?.key ?? '-'}\` then \`${lines[1]?.key ?? '-'}\`) on the ${s.pairs} rows where both have a value, in order (lags count rows, not dates).`,
      `- Lead/lag up to ${s.leadLagMax} rows either way; Granger with ${s.grangerLags} lag(s); rolling correlation over ${s.rollingWindow} rows; HP lambda ${s.hpLambda}; ADF with a constant, lags 0 to ${Object.entries(s.adfTop).map(([k, v]) => `${v} (${k})`).join(', ')}, chosen by AIC on one sample, MacKinnon (2010) critical values.`,
      '- Regression is plain OLS, as in the app: with trending series its t-statistic overstates confidence.'
    );
  } else md.push('- Correlation and OLS regression of y on x across countries.');
  md.push('', "## The app's results, to check against", '');
  const shown = result.tests.filter((t) => tests.includes(t.test));
  const left = result.tests.filter((t) => !tests.includes(t.test)).map((t) => t.title);
  if (left.length) md.push(`Not written out in the scripts (see the app's Methods page): ${[...new Set(left)].join('; ')}.`, '');
  if (!shown.length) md.push('_The scripts only read the data; none of the chart\'s tests is written out._');
  for (const t of shown) {
    md.push(`### ${t.title}`, '', t.reading, '');
    for (const f of t.figures) md.push(`- ${f.label}: ${f.value}`);
    md.push('');
  }
  if (trimmed) md.push('A line here holds the latest ' + MAX_SAVED_POINTS + ' points, the most a saved chart keeps; the app ran its tests on every point, so figures over a longer sample can differ.', '');
  if (result.notes.length) md.push('## Notes', '', ...result.notes.map((n) => `- ${n}`), '');
  if (result.missing.length) md.push('## Missing', '', ...result.missing.map((n) => `- ${n}`), '');
  md.push('## Credit', '', ...(credits.length ? credits.map((c) => `- ${c}`) : ['- Check each source\'s terms before passing the figures on.']), '', '---', '', EXPORT_NOTICE, '');
  return md.join('\n');
}

/** The pack's files and settings (the zip is built from these). */
export function replicationPack(result: ChartResult, now: Date = new Date()): ReplicationPack {
  const cross = !result.lines.length && Boolean(result.scatter);
  const asked = result.tests.map((t) => t.test);
  const tests = (cross ? CROSS_TESTS : TIME_TESTS).filter((t) => asked.includes(t)).sort((x, y) => asked.indexOf(x) - asked.indexOf(y));
  const s = cross ? null : packSettings(result);
  const cols = packLines(result).map((l) => l.key);
  return {
    files: {
      'README.md': readme(result, tests, s, now),
      'data.csv': dataCsv(result),
      'replicate.py': python(result, tests, s, cols),
      'replicate.R': rScript(result, tests, s, cols),
      'replicate.do': stata(result, tests, s, cols),
    },
    settings: s,
    tests,
  };
}

export function replicationZip(result: ChartResult, now: Date = new Date()): Uint8Array {
  const { files } = replicationPack(result, now);
  const stem = result.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50).replace(/^-|-$/g, '') || 'chart';
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [`${stem}/${name}`, strToU8(text)])));
}

export const REPLICATION_METHOD =
  "A replication pack holds the data the chart drew and the same tests in Python, R and Stata, with the settings the app used (lags, windows, HP lambda, ADF lag search), written out by hand so they match the app rather than a package default. The README lists each column with its source and credit, and the app's own figures to check against.";
