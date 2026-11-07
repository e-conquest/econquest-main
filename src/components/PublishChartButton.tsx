import React, { useMemo, useState } from 'react';
import { framedSvg, publicationCheck, publicationFooter, PUBLICATION_METHOD } from '../utils/creditLines';
import { loadShareMode } from '../utils/shareMode';

/**
 * "Publish chart": downloads the chart in `chartRef` as SVG or PNG with title, source, period,
 * as-of date and a credit line from the licence register (src/utils/creditLines.ts).
 * Sources that restrict sharing block the download until the user ticks they hold permission.
 */
export const PublishChartButton: React.FC<{
  chartRef: React.RefObject<HTMLElement | null>;
  title: string;
  subtitle?: string;
  source: string;
  period: string;
  fileName: string;
}> = ({ chartRef, title, subtitle, source, period, fileName }) => {
  // Sharing mode (Menu > Sharing mode) also holds back sources whose sharing terms are unclear.
  const check = useMemo(() => {
    const c = publicationCheck([source]);
    return loadShareMode() ? { ...c, blocked: [...c.blocked, ...c.unclear], unclear: [] } : c;
  }, [source]);
  const [credit, setCredit] = useState(() => check.credits.join(' '));
  const [hold, setHold] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const blocked = check.blocked.length > 0 && !hold;

  const build = (): { svg: string; width: number; height: number } | null => {
    const el = chartRef.current?.querySelector('svg');
    if (!el) {
      setNote('The chart is not drawn yet.');
      return null;
    }
    const box = el.getBoundingClientRect();
    const width = Math.round(box.width) || 720;
    const height = Math.round(box.height) || 260;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const chart = new XMLSerializer().serializeToString(clone);
    const asOf = new Date().toISOString().slice(0, 10);
    return { svg: framedSvg(chart, width, height, { title, subtitle, footer: publicationFooter({ source, period, asOf, credit }) }), width, height };
  };

  const save = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.${ext}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const svgOut = () => {
    const b = build();
    if (b) save(new Blob([b.svg], { type: 'image/svg+xml' }), 'svg');
  };
  const pngOut = () => {
    const b = build();
    if (!b) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([b.svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return setNote('This browser cannot draw the PNG; use SVG.');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => (png ? save(png, 'png') : setNote('The PNG could not be made; use SVG.')), 'image/png');
    };
    img.onerror = () => setNote('The PNG could not be made; use SVG.');
    img.src = url;
  };

  return (
    <details className="text-xs" data-publish-chart="true">
      <summary className="ui-btn inline-flex cursor-pointer">Publish chart (PNG or SVG)</summary>
      <div className="mt-2 space-y-2 p-3 border border-slate-200 dark:border-slate-700">
        <label className="block">
          <span className="text-slate-500 dark:text-slate-400">Credit line (from the licence register; edit if the source asks for more)</span>
          <input type="text" className="mt-1 w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white" value={credit} onChange={(e) => setCredit(e.target.value)} data-publish-credit="true" />
        </label>
        {check.blocked.map((b) => (
          <p key={b.id} className="text-amber-700 dark:text-amber-400" data-publish-blocked={b.id}>
            {b.name}: {b.why}
          </p>
        ))}
        {check.blocked.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />
            <span>I hold permission to publish figures from {check.blocked.map((b) => b.name).join(' and ')}.</span>
          </label>
        )}
        {check.unclear.map((u) => (
          <p key={u.id} className="text-slate-500 dark:text-slate-400">
            {u.name}: {u.why}
          </p>
        ))}
        {check.unmapped.length > 0 && <p className="text-slate-500 dark:text-slate-400">Not in the licence register: {check.unmapped.join('; ')}. Check its terms before publishing.</p>}
        <div className="flex gap-1.5">
          <button type="button" className="ui-btn" disabled={blocked} onClick={pngOut} data-publish-png="true">
            PNG
          </button>
          <button type="button" className="ui-btn" disabled={blocked} onClick={svgOut} data-publish-svg="true">
            SVG
          </button>
        </div>
        {note && <p className="text-amber-700 dark:text-amber-400">{note}</p>}
        <p className="text-slate-500 dark:text-slate-400">{PUBLICATION_METHOD}</p>
      </div>
    </details>
  );
};
