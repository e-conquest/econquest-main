import React from 'react';

/**
 * "Show the numbers" under a chart: the same figures as a plain table, for screen readers,
 * keyboard users and anyone who wants the values rather than the picture. Newest row first.
 */
export const ChartNumbers: React.FC<{
  caption: string;
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
  newestFirst?: boolean;
}> = ({ caption, columns, rows, newestFirst = true }) => {
  if (!rows.length) return null;
  const shown = newestFirst ? [...rows].reverse() : rows;
  return (
    <details data-chart-numbers="true">
      <summary className="text-xs text-blue-700 dark:text-blue-300 cursor-pointer">Show the numbers</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              {columns.map((c, i) => (
                <th key={c} scope="col" className={`py-1 pr-3 font-normal ${i ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                {r.map((v, j) => (
                  <td key={j} className={`py-1 pr-3 ${j ? 'text-right' : ''}`}>
                    {v === null || v === undefined || v === '' ? '–' : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
};
