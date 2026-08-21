export type FidelityMode = 'balanced' | 'high' | 'max';

/** How canvas is captured. `false` leaves canvas charts blank in replay. */
export type CanvasCapture = false | 'snapshot' | 'fps';

/** Resolved rrweb-facing settings for a fidelity mode (PLAN.md 5.1). */
export interface FidelityPreset {
  inlineStylesheet: boolean;
  collectFonts: boolean;
  inlineImages: boolean;
  recordCanvas: CanvasCapture;
  /** Only meaningful when `recordCanvas === 'fps'`. */
  canvasFps: number | null;
  /** Always false: cross-origin iframe capture is not possible. */
  recordCrossOriginIframes: false;
  mousemoveSampleMs: number;
  scrollSampleMs: number;
  /** Full-snapshot interval; bounds how far the player rewinds to seek. */
  checkoutEveryNms: number;
}
