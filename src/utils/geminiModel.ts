/**
 * Which Gemini model the app calls. One place, so a model rename by Google is one setting, not a
 * hunt through the code. Order: GEMINI_MODEL in .env (or the environment), then the quick/deep
 * model in the AI runtime settings, then the default below.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

type Env = Record<string, string | undefined>;
interface GeminiChoice {
  geminiQuickModel?: string;
  geminiDeepModel?: string;
}

export function geminiModel(cfg: GeminiChoice | undefined, env: Env, deep = false): string {
  const fromEnv = env.GEMINI_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const fromCfg = (deep ? cfg?.geminiDeepModel : cfg?.geminiQuickModel)?.trim();
  return fromCfg || DEFAULT_GEMINI_MODEL;
}
