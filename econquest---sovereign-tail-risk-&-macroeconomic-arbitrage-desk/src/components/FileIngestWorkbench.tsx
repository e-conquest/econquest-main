import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { SovereignEntity } from '../types/riskEngine';
import {
  SAMPLE_GPR_SERIES,
  generateSampleGprCsv,
  generateSampleMacroCsv
} from '../data/sampleUploadTemplates';

interface FileIngestWorkbenchProps {
  sovereigns: SovereignEntity[];
  onUpdateSovereigns: (updated: SovereignEntity[]) => void;
  onNavigateToTab: (tab: string) => void;
}

export const FileIngestWorkbench: React.FC<FileIngestWorkbenchProps> = ({
  sovereigns,
  onUpdateSovereigns,
  onNavigateToTab
}) => {
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>(SAMPLE_GPR_SERIES as unknown as Record<string, unknown>[]);
  const [fileName, setFileName] = useState<string>('Caldara_Iacoviello_GPR_Benchmark_2026.csv');
  const [detectedType, setDetectedType] = useState<'GPR' | 'Macro' | 'General'>('GPR');
  const [columnKeys, setColumnKeys] = useState<string[]>([
    'date',
    'gprGlobal',
    'gprThreats',
    'gprActs',
    'eventDescription'
  ]);
  const [selectedTargetSovereignId, setSelectedTargetSovereignId] = useState<string>('paper-walkthrough');
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const rowsPerPage = 8;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse uploaded file (CSV, TSV, XLSX, XLS)
  const processUploadedFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

      if (jsonData.length === 0) {
        alert('File contains no records or empty sheet.');
        return;
      }

      setFileName(file.name);
      setParsedData(jsonData);

      const keys = Object.keys(jsonData[0]);
      setColumnKeys(keys);

      // Automated Schema Detection
      const lowerKeys = keys.map((k) => k.toLowerCase());
      const isGpr = lowerKeys.some(
        (k) =>
          k.includes('gpr') ||
          k.includes('geopolitical') ||
          k.includes('threat') ||
          k.includes('act')
      );
      const isMacro = lowerKeys.some(
        (k) =>
          k.includes('debt') ||
          k.includes('gdp') ||
          k.includes('reserves') ||
          k.includes('deficit') ||
          k.includes('cds')
      );

      if (isGpr) setDetectedType('GPR');
      else if (isMacro) setDetectedType('Macro');
      else setDetectedType('General');

      setCurrentPage(1);
      setApplyFeedback(null);
    } catch (err) {
      console.error('File parsing error:', err);
      alert('Error parsing file. Please ensure it is a valid CSV, TSV, or Excel (.xlsx, .xls) file.');
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFile(e.target.files[0]);
    }
  };

  // Download template files
  const downloadCsv = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Apply parsed GPR or Macro data to the Risk Engine
  const handleApplyToEngine = () => {
    if (parsedData.length === 0) return;

    if (detectedType === 'GPR') {
      // Find latest or highest GPR point
      const lastRow = parsedData[parsedData.length - 1];
      const gprValue = Number(
        lastRow['gprGlobal'] ||
          lastRow['gpr_global'] ||
          lastRow['GPR'] ||
          lastRow['gpr'] ||
          lastRow['GPR_GLOBAL'] ||
          150.0
      );

      // Caldara-Iacoviello baseline is normalized around 100
      // Text Stress Index (TSI) z-score: TSI = (GPR - 100) / 45
      const calculatedTsi = Math.round(((gprValue - 100) / 45) * 10) / 10;
      const calculatedPitf = Math.min(10, Math.max(1, 2.5 + calculatedTsi * 1.4));

      const updated = sovereigns.map((s) => {
        if (selectedTargetSovereignId === 'ALL' || s.id === selectedTargetSovereignId) {
          // Check if country-specific GPR column exists in dataset (e.g. gpr_chl, gpr_arg)
          const codeKey = `gpr_${s.code.toLowerCase()}`;
          const codeKeyUpper = `GPR_${s.code.toUpperCase()}`;
          const specificVal = Number(lastRow[codeKey] || lastRow[codeKeyUpper]);

          let targetTsi = calculatedTsi;
          if (!isNaN(specificVal) && specificVal > 0) {
            targetTsi = Math.round(((specificVal - 100) / 45) * 10) / 10;
          }

          return {
            ...s,
            textStressIndex: targetTsi,
            politicalInstabilityPitf: Math.min(10, Math.max(1, s.politicalInstabilityPitf * 0.7 + calculatedPitf * 0.3)),
            pillarScores: {
              ...s.pillarScores,
              p4_politicalDynamics: Math.min(100, Math.max(10, s.pillarScores.p4_politicalDynamics + targetTsi * 4.2))
            }
          };
        }
        return s;
      });

      onUpdateSovereigns(updated);
      setApplyFeedback(
        `Applied Caldara-Iacoviello GPR index (${gprValue.toFixed(1)}) to sovereign risk engine. Derived Text Stress Index: ${
          calculatedTsi >= 0 ? `+${calculatedTsi.toFixed(1)}σ` : `${calculatedTsi.toFixed(1)}σ`
        }. Layer 2 Bayesian log-odds and arbitrage signals updated!`
      );
    } else if (detectedType === 'Macro') {
      // Map macro columns directly to sovereign entity variables
      const updated = sovereigns.map((s) => {
        // Match row by country_code or country_name
        const match = parsedData.find((row) => {
          const rowCode = String(row['country_code'] || row['code'] || '').trim().toUpperCase();
          const rowName = String(row['country_name'] || row['name'] || row['country'] || '').trim().toLowerCase();
          return rowCode === s.code.toUpperCase() || rowName === s.name.toLowerCase();
        });

        if (match) {
          return {
            ...s,
            publicDebtToGdp: match['public_debt_gdp'] ? Number(match['public_debt_gdp']) : s.publicDebtToGdp,
            shortTermFxDebtToReserves: match['short_term_fx_debt_reserves']
              ? Number(match['short_term_fx_debt_reserves'])
              : s.shortTermFxDebtToReserves,
            netReservesToImportsMonths: match['net_reserves_imports_months']
              ? Number(match['net_reserves_imports_months'])
              : s.netReservesToImportsMonths,
            primaryDeficitGap: match['primary_deficit_gap']
              ? Number(match['primary_deficit_gap'])
              : s.primaryDeficitGap,
            cdsSpread5yBps: match['cds_spread_5y_bps'] ? Number(match['cds_spread_5y_bps']) : s.cdsSpread5yBps
          };
        }
        return s;
      });

      onUpdateSovereigns(updated);
      setApplyFeedback(
        `Macro-fiscal panel applied successfully across matched sovereigns. Recalculated Layer 1 Hazard and Merton Balance Sheet CCA!`
      );
    }
  };

  // Pagination calculation
  const totalPages = Math.ceil(parsedData.length / rowsPerPage) || 1;
  const currentRows = parsedData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  // Extract GPR values for sparkline/chart if GPR dataset
  const gprPoints = parsedData
    .map((row) => {
      const val = Number(
        row['gprGlobal'] ||
          row['gpr_global'] ||
          row['GPR'] ||
          row['gpr'] ||
          row['GPR_GLOBAL'] ||
          0
      );
      const date = String(row['date'] || row['month'] || row['year'] || '');
      return { date, val };
    })
    .filter((p) => !isNaN(p.val) && p.val > 0);

  const maxGpr = gprPoints.length > 0 ? Math.max(...gprPoints.map((p) => p.val), 350) : 350;
  const latestGpr = gprPoints.length > 0 ? gprPoints[gprPoints.length - 1].val : 100;
  const latestTsi = Math.round(((latestGpr - 100) / 45) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-100">
              CSV &amp; Excel Data Ingestion Workbench
            </h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              Caldara &amp; Iacoviello GPR Ready
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Upload custom spreadsheets (`.csv`, `.xlsx`, `.xls`, `.tsv`) containing Geopolitical Risk (GPR) indices,
            macro solvency indicators, or custom sovereign risk series.
          </p>
        </div>

        {/* Template Download Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => downloadCsv(generateSampleGprCsv(), 'Caldara_Iacoviello_GPR_Sample.csv')}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111726] hover:bg-[#152037] border border-[#23314d] rounded transition-colors whitespace-nowrap"
          >
            Download GPR CSV Template
          </button>

          <button
            onClick={() => downloadCsv(generateSampleMacroCsv(), 'Sovereign_Macro_Solvency_Panel.csv')}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111726] hover:bg-[#152037] border border-[#23314d] rounded transition-colors whitespace-nowrap"
          >
            Download Macro CSV Template
          </button>
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        className="p-8 bg-[#090d16] border-2 border-dashed border-[#1a2438] hover:border-emerald-500/60 rounded-lg text-center cursor-pointer transition-colors space-y-2 group"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept=".csv,.xlsx,.xls,.tsv"
          className="hidden"
        />
        <div className="w-10 h-10 mx-auto rounded-full bg-[#111726] group-hover:bg-emerald-500/10 flex items-center justify-center font-mono text-emerald-400 text-lg transition-colors">
          ↑
        </div>
        <div className="text-sm font-semibold text-slate-200">
          Drop your CSV or Excel (`.xlsx`, `.xls`, `.tsv`) file here, or click to browse
        </div>
        <div className="text-xs text-slate-500 font-mono">
          Supports Caldara-Iacoviello GPR Monthly Datasets, IMF WEO/FSI tables, and custom sovereign risk panels
        </div>
      </div>

      {/* Active File Metadata & Schema Detection Card */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">Loaded File:</span>
            <span className="font-mono text-xs font-bold text-emerald-400">{fileName}</span>
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                detectedType === 'GPR'
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                  : detectedType === 'Macro'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              Schema: {detectedType === 'GPR' ? 'Caldara-Iacoviello Geopolitical Risk' : detectedType === 'Macro' ? 'Sovereign Macro Solvency' : 'General Table'}
            </span>
          </div>
          <div className="text-xs text-slate-400 font-mono">
            {parsedData.length} records parsed · {columnKeys.length} columns detected (
            {columnKeys.slice(0, 5).join(', ')}
            {columnKeys.length > 5 ? '...' : ''})
          </div>
        </div>

        {/* Engine Injection Control */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 font-mono shrink-0">Inject Into:</label>
          <select
            value={selectedTargetSovereignId}
            onChange={(e) => setSelectedTargetSovereignId(e.target.value)}
            className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-3 py-1.5 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="ALL">All Monitored Sovereigns</option>
            {sovereigns.map((s) => (
              <option key={s.id} value={s.id}>
                {s.flag} {s.name} ({s.code})
              </option>
            ))}
          </select>

          <button
            onClick={handleApplyToEngine}
            className="px-4 py-1.5 text-xs font-semibold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors whitespace-nowrap shadow-xs"
          >
            Apply to Risk Engine →
          </button>
        </div>
      </div>

      {/* Applied Feedback Banner */}
      {applyFeedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-600/40 rounded-lg text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold">✓ Success:</span>
            <span>{applyFeedback}</span>
          </div>
          <button
            onClick={() => onNavigateToTab('pipeline')}
            className="text-xs underline font-mono text-emerald-200 hover:text-white"
          >
            Inspect Pipeline &amp; Arbitrage →
          </button>
        </div>
      )}

      {/* GPR Historical Time Series Visualizer (If GPR detected) */}
      {detectedType === 'GPR' && gprPoints.length > 0 && (
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Caldara &amp; Iacoviello Geopolitical Risk (GPR) Time Series
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Benchmark index normalized at 100. High geopolitical stress &gt; 150; crisis escalation &gt; 250.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <span className="text-slate-400 text-[11px] block">Latest GPR Value:</span>
                <span className="text-lg font-bold text-emerald-400">{latestGpr.toFixed(1)}</span>
              </div>
              <div className="text-right pl-3 border-l border-[#1a2438]">
                <span className="text-slate-400 text-[11px] block">Derived TSI z-score:</span>
                <span className="text-lg font-bold text-cyan-400">
                  {latestTsi >= 0 ? `+${latestTsi.toFixed(1)}σ` : `${latestTsi.toFixed(1)}σ`}
                </span>
              </div>
            </div>
          </div>

          {/* Responsive SVG GPR Sparkline Chart */}
          <div className="h-44 w-full bg-[#090d16] border border-[#1a2438] rounded p-2">
            <svg className="w-full h-full" viewBox="0 0 600 140" preserveAspectRatio="none">
              {/* Reference Grid & Thresholds */}
              <line x1="40" y1="20" x2="580" y2="20" stroke="#1a2438" strokeDasharray="3 3" />
              <line x1="40" y1="60" x2="580" y2="60" stroke="#1a2438" strokeDasharray="3 3" />
              <line x1="40" y1="100" x2="580" y2="100" stroke="#1a2438" strokeDasharray="3 3" />

              {/* Baseline 100 reference line */}
              <line
                x1="40"
                y1={130 - (100 / maxGpr) * 110}
                x2="580"
                y2={130 - (100 / maxGpr) * 110}
                stroke="#64748b"
                strokeWidth="1"
                strokeDasharray="4 2"
              />

              {/* Stress 200 reference line */}
              <line
                x1="40"
                y1={130 - (200 / maxGpr) * 110}
                x2="580"
                y2={130 - (200 / maxGpr) * 110}
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="2 2"
              />

              {/* GPR Area */}
              {gprPoints.length > 1 && (
                <polygon
                  points={`40,130 ${gprPoints
                    .map((pt, i) => {
                      const x = 40 + (i / (gprPoints.length - 1)) * 540;
                      const y = Math.max(15, 130 - (pt.val / maxGpr) * 110);
                      return `${x},${y}`;
                    })
                    .join(' ')} 580,130`}
                  fill="rgba(6, 182, 212, 0.12)"
                />
              )}

              {/* GPR Line */}
              {gprPoints.length > 1 && (
                <polyline
                  points={gprPoints
                    .map((pt, i) => {
                      const x = 40 + (i / (gprPoints.length - 1)) * 540;
                      const y = Math.max(15, 130 - (pt.val / maxGpr) * 110);
                      return `${x},${y}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="2"
                />
              )}

              {/* Points */}
              {gprPoints.map((pt, i) => {
                const x = 40 + (i / (gprPoints.length - 1)) * 540;
                const y = Math.max(15, 130 - (pt.val / maxGpr) * 110);
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={i === gprPoints.length - 1 ? 4 : 2.5}
                    fill={i === gprPoints.length - 1 ? '#10b981' : '#06b6d4'}
                  />
                );
              })}

              {/* Bottom Baseline */}
              <line x1="40" y1="130" x2="580" y2="130" stroke="#334155" strokeWidth="1" />
            </svg>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>{gprPoints[0]?.date || '1990'}</span>
            <span className="text-slate-400">Dashed Gray: 100 Baseline · Dashed Amber: 200 Severe Stress</span>
            <span>{gprPoints[gprPoints.length - 1]?.date || '2026-10'}</span>
          </div>
        </div>
      )}

      {/* Parsed Data Preview Table */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">Parsed Ingest Records Preview</h3>
          <div className="text-xs font-mono text-slate-400">
            Showing {(currentPage - 1) * rowsPerPage + 1}–
            {Math.min(currentPage * rowsPerPage, parsedData.length)} of {parsedData.length}
          </div>
        </div>

        <div className="overflow-x-auto border border-[#1a2438] rounded">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 text-[11px] uppercase">
                {columnKeys.map((col) => (
                  <th key={col} className="py-2.5 px-3 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/60 text-[11px]">
              {currentRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[#131d33] transition-colors">
                  {columnKeys.map((col) => {
                    const val = row[col];
                    const isNumeric = typeof val === 'number';
                    return (
                      <td
                        key={col}
                        className={`py-2 px-3 whitespace-nowrap ${
                          isNumeric ? 'text-slate-200' : 'text-slate-400'
                        }`}
                      >
                        {String(val ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-xs font-mono">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-[#111726] border border-[#23314d] text-slate-300 rounded disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-slate-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-[#111726] border border-[#23314d] text-slate-300 rounded disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
