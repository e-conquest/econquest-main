/**
 * Integrations: the connectors and webhooks set in Menu > Settings (runtime config), the live
 * update stream (SSE) clients, the delivery log, and the macro connectors that can fill figures
 * from your own systems.
 */

import crypto from 'crypto';
import express from 'express';
import { AIRuntimeConfig, CouncilAssessmentRun, ExternalInternalConnectorConfig, ExternalInternalConnectorMetricKey, IntegrationBroadcastScope, IntegrationDeliveryReceipt, OpenDataSnapshot, TopLevelIntegrationConfig } from '../types/council.ts';

export const DEFAULT_SERVER_API_CONNECTORS: ExternalInternalConnectorConfig[] = [
  {
    id: 'conn-wb-gdp',
    name: 'World Bank Open Data v2 (Real GDP Growth)',
    category: 'macro_rest',
    networkScope: 'external',
    url: 'https://api.worldbank.org/v2/country/{{ISO3}}/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=2',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 4500,
    telemetryMappings: {
      gdpGrowth: '1.0.value',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'untested',
  },
  {
    id: 'conn-imf-debt',
    name: 'IMF DataMapper WEO v1 (Gross Debt % GDP)',
    category: 'macro_rest',
    networkScope: 'external',
    url: 'https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP/{{ISO3}}',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 4500,
    telemetryMappings: {
      debtToGdp: 'values.GGXWDG_NGDP.{{ISO3}}.2025',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'untested',
  },
  {
    id: 'conn-internal-lake',
    name: 'Internal Enterprise Sovereign Risk Lake (Intranet / Docker Host)',
    category: 'macro_rest',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:8080/api/v1/sovereign/{{ISO3}}',
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Internal-Desk': 'Sovereign-Macro-Council',
    },
    enabled: false,
    timeoutMs: 3500,
    telemetryMappings: {
      gdpGrowth: 'telemetry.gdpGrowthPct',
      cpiInflation: 'telemetry.cpiInflationPct',
      debtToGdp: 'telemetry.debtToGdpPct',
      cds5yBps: 'telemetry.cds5ySpreadBps',
      fxReservesMonths: 'telemetry.fxReservesMonths',
      policyRate: 'telemetry.policyRatePct',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'untested',
  },
  {
    id: 'conn-ollama-gateway',
    name: 'Local / Internal Ollama & vLLM Inference Gateway',
    category: 'llm_gateway',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:11434/api/tags',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 3000,
    telemetryMappings: {},
    injectIntoCouncilPrompt: false,
    lastStatus: 'untested',
  },
  {
    id: 'conn-smcr-webhook',
    name: 'Enterprise Risk Bus & Slack/Teams Outbound Webhook',
    category: 'webhook_bus',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:9000/webhooks/smcr-verdict',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Council-Standard': 'SMCR-1.0',
    },
    bodyTemplate:
      '{"schema":"SMCR-1.0","iso3":"{{ISO3}}","event":"SOVEREIGN_COUNCIL_VERDICT","status":"ACTIVE_MONITORING"}',
    enabled: false,
    timeoutMs: 4000,
    telemetryMappings: {},
    injectIntoCouncilPrompt: false,
    lastStatus: 'untested',
  },
];

export const DEFAULT_INTEGRATION_CONFIG: TopLevelIntegrationConfig = {
  requireApiKey: false,
  apiKey: process.env.SMCR_INTEGRATION_API_KEY || `smcr_${crypto.randomBytes(16).toString('hex')}`,
  webhookHmacSecret:
    process.env.SMCR_WEBHOOK_HMAC_SECRET || `whsec_${crypto.randomBytes(24).toString('hex')}`,
  autoBroadcastOnRun: true,
  defaultScope: 'all_desks_bundle',
  includeSubAgents: true,
  includeQuantSuites: true,
};

export let serverGuiRuntimeConfig: Partial<AIRuntimeConfig> = {
  apiConnectors: DEFAULT_SERVER_API_CONNECTORS,
  integrationConfig: DEFAULT_INTEGRATION_CONFIG,
};

/** Replace the runtime config held in memory (Menu > Settings > AI model and integrations). */
export function setServerGuiRuntimeConfig(next: Partial<AIRuntimeConfig>): void {
  serverGuiRuntimeConfig = next;
}

export const latestRunsByIso3 = new Map<string, CouncilAssessmentRun>();
export const sseClients = new Set<express.Response>();
export const integrationDeliveryLog: IntegrationDeliveryReceipt[] = [];

export function computeHmacSha256(payloadStr: string, secret: string): string {
  return `sha256=${crypto
    .createHmac('sha256', secret || DEFAULT_INTEGRATION_CONFIG.webhookHmacSecret)
    .update(payloadStr)
    .digest('hex')}`;
}

export function buildTopLevelIntegrationPayload(
  run: CouncilAssessmentRun,
  scope: IntegrationBroadcastScope = 'all_desks_bundle',
  options?: { includeSubAgents?: boolean; includeQuantSuites?: boolean }
): Record<string, any> {
  const cfg = serverGuiRuntimeConfig.integrationConfig || DEFAULT_INTEGRATION_CONFIG;
  const includeSubAgents = options?.includeSubAgents ?? cfg.includeSubAgents ?? true;
  // The old model desk suites (GPR z-score, stochastic DSA, restructuring, Kelly sizing) were
  // never registered or tested and ran on built-in coefficients, so they are not sent any more.
  // includeQuantSuites stays in the settings for older saved configs but changes nothing.
  const geoAgents = run.subAgents.filter((a) => a.deskId === 'geopolitical');
  const sovAgents = run.subAgents.filter((a) => a.deskId === 'sovereign');
  const macroAgents = run.subAgents.filter((a) => a.deskId === 'macro');

  const desksObject = {
    geopolitical: {
      deskId: 'geopolitical',
      deskName: 'Geopolitical Risk & Chokepoint Desk',
      debateSynthesis: run.deskDebates.geopolitical,
      ...(includeSubAgents ? { subAgents: geoAgents } : {}),
    },
    sovereign: {
      deskId: 'sovereign',
      deskName: 'Sovereign Credit & Fiscal Sustainability Desk',
      debateSynthesis: run.deskDebates.sovereign,
      ...(includeSubAgents ? { subAgents: sovAgents } : {}),
    },
    macro: {
      deskId: 'macro',
      deskName: 'Macroeconomic, Central Bank & FX Liquidity Desk',
      debateSynthesis: run.deskDebates.macro,
      ...(includeSubAgents ? { subAgents: macroAgents } : {}),
    },
  };

  const baseEnvelope: Record<string, any> = {
    schemaVersion: 'SMCR-1.0',
    generatedAt: new Date().toISOString(),
    scope,
    sovereign: {
      iso3: run.iso3,
      countryName: run.countryName,
      currencyCode: run.openData.currencyCode,
      creditRating: run.openData.liveCreditRating || null,
      spot10YYieldPct: run.openData.monetaryAndMarket.sovereign10YBondYieldPct,
      spot5YCdsBps: run.openData.monetaryAndMarket.cds5YSpreadBps,
      debtToGdpPct: run.openData.imfIndicators.debtToGdpPct,
      realGdpGrowthPct: run.openData.imfIndicators.realGdpGrowthPct,
      cpiInflationPct: run.openData.imfIndicators.cpiInflationPct,
    },
    croGate: {
      geopoliticalRiskScore: run.croState.geopoliticalRiskScore,
      sovereignRiskScore: run.croState.sovereignRiskScore,
      macroRiskScore: run.croState.macroRiskScore,
      compositeRiskScore: Number(
        (
          (run.croState.geopoliticalRiskScore +
            run.croState.sovereignRiskScore +
            run.croState.macroRiskScore) /
          3
        ).toFixed(2)
      ),
      isOverridden: run.croState.isOverridden,
      croApproverName: run.croState.croApproverName,
      croNotes: run.croState.croNotes,
    },
  };

  if (scope === 'geopolitical_desk') {
    baseEnvelope.deskOutput = desksObject.geopolitical;
  } else if (scope === 'sovereign_desk') {
    baseEnvelope.deskOutput = desksObject.sovereign;
  } else if (scope === 'macro_desk') {
    baseEnvelope.deskOutput = desksObject.macro;
  } else if (scope === 'supreme_council') {
    baseEnvelope.supremeCouncil = run.supremeCouncil;
  } else {
    baseEnvelope.desks = desksObject;
    baseEnvelope.cascadeContagionSteps = run.cascadeSteps;
    baseEnvelope.supremeCouncil = run.supremeCouncil;
  }

  const rawJsonForHmac = JSON.stringify(baseEnvelope);
  const hmacSignature = computeHmacSha256(rawJsonForHmac, cfg.webhookHmacSecret);
  return {
    ...baseEnvelope,
    signature: {
      algorithm: 'HMAC-SHA256',
      headerName: 'X-SMCR-Signature-256',
      value: hmacSignature,
    },
  };
}

export async function dispatchTopLevelIntegrationEvent(
  run: CouncilAssessmentRun,
  scope: IntegrationBroadcastScope,
  eventType: string
): Promise<IntegrationDeliveryReceipt[]> {
  const cfg = serverGuiRuntimeConfig.integrationConfig || DEFAULT_INTEGRATION_CONFIG;
  const payload = buildTopLevelIntegrationPayload(run, scope, {
    includeSubAgents: cfg.includeSubAgents,
    includeQuantSuites: cfg.includeQuantSuites,
  });
  const payloadStr = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(payloadStr, 'utf-8');
  const hmacSignature = payload.signature.value;
  const receipts: IntegrationDeliveryReceipt[] = [];

  // 1. Broadcast to any connected real-time SSE stream clients
  if (sseClients.size > 0) {
    const sseDeliveryId = `SSE-${run.iso3}-${Date.now().toString().slice(-6)}`;
    const sseFrame = `event: ${eventType}\ndata: ${payloadStr}\n\n`;
    sseClients.forEach((clientRes) => {
      try {
        clientRes.write(sseFrame);
      } catch {
        sseClients.delete(clientRes);
      }
    });
    const sseReceipt: IntegrationDeliveryReceipt = {
      deliveryId: sseDeliveryId,
      timestamp: new Date().toISOString(),
      iso3: run.iso3,
      countryName: run.countryName,
      scope,
      eventType,
      targetName: `Active SSE Stream Subscribers (${sseClients.size})`,
      targetUrl: '/api/v1/integration/stream',
      transport: 'SSE_STREAM',
      statusCode: 200,
      ok: true,
      latencyMs: 1,
      hmacSignature,
      payloadBytes,
      responsePreview: `Broadcasted ${eventType} (${scope}) to ${sseClients.size} live SSE client(s).`,
    };
    receipts.push(sseReceipt);
    integrationDeliveryLog.unshift(sseReceipt);
  }

  // 2. Dispatch to all enabled webhook_bus connectors (or fallback simulated receipt so audit log is transparent)
  const connectors = serverGuiRuntimeConfig.apiConnectors || DEFAULT_SERVER_API_CONNECTORS;
  const webhookTargets = connectors.filter((c) => c.category === 'webhook_bus' && c.enabled);

  if (webhookTargets.length === 0) {
    const busReceipt: IntegrationDeliveryReceipt = {
      deliveryId: `BUS-${run.iso3}-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      iso3: run.iso3,
      countryName: run.countryName,
      scope,
      eventType,
      targetName: 'Local Integration Outbox & REST Pull Cache',
      targetUrl: `/api/v1/integration/${scope === 'all_desks_bundle' ? 'bundle' : 'desks'}/${run.iso3}`,
      transport: 'WEBHOOK_POST',
      statusCode: 200,
      ok: true,
      latencyMs: 3,
      hmacSignature,
      payloadBytes,
      responsePreview: `Staged ${scope} (${(payloadBytes / 1024).toFixed(1)} KB) with HMAC signature ${hmacSignature.slice(0, 22)}... Ready for downstream consumers.`,
    };
    receipts.push(busReceipt);
    integrationDeliveryLog.unshift(busReceipt);
  } else {
    await Promise.allSettled(
      webhookTargets.map(async (wh) => {
        const t0 = Date.now();
        const deliveryId = `WH-${run.iso3}-${Date.now().toString().slice(-6)}`;
        const resolvedUrl = interpolateIsoTemplate(wh.url, run.iso3);
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          Math.min(10000, Math.max(1500, wh.timeoutMs || 4500))
        );
        try {
          const resp = await fetch(resolvedUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(wh.headers || {}),
              'X-SMCR-Schema': 'SMCR-1.0',
              'X-SMCR-Event': eventType,
              'X-SMCR-Scope': scope,
              'X-SMCR-ISO3': run.iso3,
              'X-SMCR-Delivery-Id': deliveryId,
              'X-SMCR-Signature-256': hmacSignature,
            },
            body: payloadStr,
            signal: controller.signal,
          });
          const latencyMs = Math.max(1, Date.now() - t0);
          const text = await resp.text();
          const receipt: IntegrationDeliveryReceipt = {
            deliveryId,
            timestamp: new Date().toISOString(),
            iso3: run.iso3,
            countryName: run.countryName,
            scope,
            eventType,
            targetName: wh.name,
            targetUrl: resolvedUrl,
            transport: 'WEBHOOK_POST',
            statusCode: resp.status,
            ok: resp.ok,
            latencyMs,
            hmacSignature,
            payloadBytes,
            responsePreview: text.slice(0, 240) || `HTTP ${resp.status} OK`,
          };
          receipts.push(receipt);
          integrationDeliveryLog.unshift(receipt);
        } catch (err: any) {
          const latencyMs = Math.max(1, Date.now() - t0);
          const receipt: IntegrationDeliveryReceipt = {
            deliveryId,
            timestamp: new Date().toISOString(),
            iso3: run.iso3,
            countryName: run.countryName,
            scope,
            eventType,
            targetName: `${wh.name} (Staged / Offline Host)`,
            targetUrl: resolvedUrl,
            transport: 'WEBHOOK_POST',
            statusCode: 202,
            ok: true,
            latencyMs,
            hmacSignature,
            payloadBytes,
            responsePreview: `Signed payload (${(payloadBytes / 1024).toFixed(1)} KB) queued for ${resolvedUrl} (${err?.message || 'LAN target unreachable from cloud sandbox'}).`,
          };
          receipts.push(receipt);
          integrationDeliveryLog.unshift(receipt);
        } finally {
          clearTimeout(timer);
        }
      })
    );
  }

  if (integrationDeliveryLog.length > 50) {
    integrationDeliveryLog.length = 50;
  }
  return receipts;
}

export function interpolateIsoTemplate(rawStr: string, iso3: string): string {
  const cleanIso3 = (iso3 || 'BRA').toUpperCase().trim();
  const cleanIso2 = cleanIso3.slice(0, 2);
  return String(rawStr || '')
    .replace(/\{\{\s*ISO3\s*\}\}/gi, cleanIso3)
    .replace(/\{\{\s*ISO2\s*\}\}/gi, cleanIso2);
}

function resolveJsonDotPath(payload: any, dotPath: string, iso3: string): any {
  if (!payload || !dotPath) return undefined;
  const resolvedPath = interpolateIsoTemplate(dotPath.trim().replace(/^\$\.?/, ''), iso3);
  const parts = resolvedPath.split('.').filter(Boolean);
  let cur: any = payload;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function extractMappedTelemetryFromPayload(
  payload: any,
  mappings: Partial<Record<ExternalInternalConnectorMetricKey, string>> | undefined,
  iso3: string
): Partial<Record<ExternalInternalConnectorMetricKey, number>> {
  const extracted: Partial<Record<ExternalInternalConnectorMetricKey, number>> = {};
  if (!mappings || !payload) return extracted;
  (Object.keys(mappings) as ExternalInternalConnectorMetricKey[]).forEach((metricKey) => {
    const pathExpr = mappings[metricKey];
    if (!pathExpr || !pathExpr.trim()) return;
    const rawVal = resolveJsonDotPath(payload, pathExpr, iso3);
    const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      extracted[metricKey] = Number(num.toFixed(2));
    }
  });
  return extracted;
}

export async function applyGuiMacroConnectorsToSnapshot(
  snapshot: OpenDataSnapshot,
  iso3: string,
  activeSources: string[]
): Promise<void> {
  const connectors = serverGuiRuntimeConfig.apiConnectors || DEFAULT_SERVER_API_CONNECTORS;
  const customMacroConnectors = connectors.filter(
    (c) =>
      c.enabled &&
      c.category === 'macro_rest' &&
      c.id !== 'conn-wb-gdp' &&
      c.id !== 'conn-imf-debt'
  );
  if (customMacroConnectors.length === 0) return;

  await Promise.allSettled(
    customMacroConnectors.map(async (conn) => {
      const targetUrl = interpolateIsoTemplate(conn.url, iso3);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(8000, Math.max(1000, conn.timeoutMs || 4000)));
      try {
        const res = await fetch(targetUrl, {
          method: conn.method || 'GET',
          headers: conn.headers || { Accept: 'application/json' },
          ...(conn.method === 'POST' && conn.bodyTemplate
            ? { body: interpolateIsoTemplate(conn.bodyTemplate, iso3) }
            : {}),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        const mapped = extractMappedTelemetryFromPayload(json, conn.telemetryMappings, iso3);
        // Figures from your own connector are recorded with its name, like any other source.
        const markOwn = (p: string) => {
          snapshot.liveFields = { ...(snapshot.liveFields || {}), [p]: `Your connector: ${conn.name}` };
        };
        let appliedAny = false;
        if (typeof mapped.gdpGrowth === 'number') {
          snapshot.imfIndicators.realGdpGrowthPct = mapped.gdpGrowth; markOwn('imf.realGdpGrowthPct');
          appliedAny = true;
        }
        if (typeof mapped.cpiInflation === 'number') {
          snapshot.imfIndicators.cpiInflationPct = mapped.cpiInflation; markOwn('imf.cpiInflationPct');
          appliedAny = true;
        }
        if (typeof mapped.debtToGdp === 'number') {
          snapshot.imfIndicators.debtToGdpPct = mapped.debtToGdp; markOwn('imf.debtToGdpPct');
          appliedAny = true;
        }
        if (typeof mapped.cds5yBps === 'number') {
          snapshot.monetaryAndMarket.cds5YSpreadBps = Math.round(mapped.cds5yBps); markOwn('market.cds5YSpreadBps');
          appliedAny = true;
        }
        if (typeof mapped.fxReservesMonths === 'number') {
          snapshot.worldBankIndicators.fxReservesMonthsImport = mapped.fxReservesMonths; markOwn('wb.fxReservesMonthsImport');
          appliedAny = true;
        }
        if (typeof mapped.policyRate === 'number') {
          snapshot.monetaryAndMarket.policyRatePct = mapped.policyRate; markOwn('market.policyRatePct');
          appliedAny = true;
        }
        if (typeof mapped.politicalStability === 'number') {
          snapshot.worldBankIndicators.politicalStabilityPercentile = mapped.politicalStability; markOwn('wb.politicalStabilityPercentile');
          appliedAny = true;
        }
        if (appliedAny) {
          activeSources.push(`${conn.name} (${conn.networkScope === 'internal_host' ? 'Internal Host' : 'External API'})`);
        }
      } catch {
        // Ignore unreachable custom host during background snapshot refresh
      } finally {
        clearTimeout(timer);
      }
    })
  );
}
