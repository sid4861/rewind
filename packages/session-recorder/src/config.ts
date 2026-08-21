import {
  DEFAULT_ASSET_BUDGET_BYTES,
  DEFAULT_BODY_CAP_BYTES,
  DEFAULT_FIDELITY_MODE,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_EVENTS,
  DEFAULT_NETWORK_BODY_BUDGET_BYTES,
  FIDELITY_PRESETS,
  type FidelityMode,
  type FidelityPreset,
} from '@rewind/session-schema';
import type { RedactionOptions } from './network/redact';

export interface RecorderLimits {
  maxDurationMs: number;
  maxEvents: number;
  /** Per-body cap; larger bodies are truncated with `truncated: true`. */
  bodyCapBytes: number;
  /** Cumulative cap across all bodies; afterwards entries keep metadata only. */
  networkBodyBudgetBytes: number;
  /** Cap on bytes copied into `assets/`; past it, assets stay inline. */
  assetBudgetBytes: number;
}

export interface RecorderConfig {
  /** Must be explicitly true. Guard #1 of PLAN.md 4.9. */
  enabled?: boolean;
  appName: string;
  appVersion?: string | null;
  gitSha?: string | null;
  fidelity?: FidelityMode;
  limits?: Partial<RecorderLimits>;
  /**
   * Extends the built-in denylists; it never replaces them. There is
   * deliberately no option to disable redaction — fidelity settings must never
   * be able to widen what reaches the archive (PLAN.md 4.6).
   */
  redaction?: RedactionOptions;
  /**
   * Escape hatch for the production refusal. Named to be uncomfortable to type
   * and impossible to set by accident.
   */
  allowInProduction?: boolean;
}

export interface ResolvedConfig {
  enabled: boolean;
  appName: string;
  appVersion: string | null;
  gitSha: string | null;
  fidelity: FidelityMode;
  preset: FidelityPreset;
  limits: RecorderLimits;
  redaction: RedactionOptions;
  allowInProduction: boolean;
}

export function resolveConfig(config: RecorderConfig): ResolvedConfig {
  const fidelity = config.fidelity ?? DEFAULT_FIDELITY_MODE;
  return {
    enabled: config.enabled ?? false,
    appName: config.appName,
    appVersion: config.appVersion ?? null,
    gitSha: config.gitSha ?? null,
    fidelity,
    preset: FIDELITY_PRESETS[fidelity],
    limits: {
      maxDurationMs: config.limits?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      maxEvents: config.limits?.maxEvents ?? DEFAULT_MAX_EVENTS,
      bodyCapBytes: config.limits?.bodyCapBytes ?? DEFAULT_BODY_CAP_BYTES,
      networkBodyBudgetBytes:
        config.limits?.networkBodyBudgetBytes ?? DEFAULT_NETWORK_BODY_BUDGET_BYTES,
      assetBudgetBytes: config.limits?.assetBudgetBytes ?? DEFAULT_ASSET_BUDGET_BYTES,
    },
    redaction: config.redaction ?? {},
    allowInProduction: config.allowInProduction ?? false,
  };
}

/**
 * Guard #2 of PLAN.md 4.9: refuse to start in production even when `enabled` is
 * somehow true. `enabled` alone is not sufficient for something that will
 * capture request bodies once M2 lands.
 */
export function refusalReason(config: ResolvedConfig): string | null {
  if (!config.enabled) {
    return 'Recorder is disabled. Pass enabled={true} to activate it.';
  }
  const isProduction =
    typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production';
  if (isProduction && !config.allowInProduction) {
    return 'Recorder refuses to start in a production build. This is a safety guard, not a bug.';
  }
  return null;
}
