import type { DomEvent, FidelityPreset } from '@rewind/session-schema';
import { record } from 'rrweb';
import {
  BLOCK_CLASS,
  BLOCK_SELECTOR,
  IGNORE_SELECTOR,
  MASK_INPUT_SELECTOR,
  MASK_TEXT_SELECTOR,
} from '../constants';

/**
 * Every input tag and type rrweb recognises.
 *
 * Passing all of them opens rrweb's masking gate unconditionally so
 * `maskInputFn` above is always consulted; it does not by itself mask anything.
 */
const MASKABLE_INPUT_TYPES: Record<string, boolean> = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  month: true,
  number: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
  password: true,
};

export interface DomCaptureHandle {
  stop(): void;
  /** Forces a fresh full snapshot; used when resuming from pause. */
  takeFullSnapshot(): void;
}

/**
 * Translate a fidelity preset into rrweb's record options.
 *
 * The mapping is not one-to-one: rrweb's `recordCanvas` is a boolean, and the
 * snapshot-vs-fps distinction actually lives in `sampling.canvas` ('all' for
 * per-mutation snapshots, a number for fps). The schema models the *intent*
 * ('snapshot' | 'fps') and this is where it becomes rrweb's shape, so the rest
 * of the codebase never has to know rrweb spells it across two fields.
 */
export function buildRecordOptions(
  preset: FidelityPreset,
  maskAllInputs = true,
): {
  inlineStylesheet: boolean;
  collectFonts: boolean;
  inlineImages: boolean;
  recordCanvas: boolean;
  recordCrossOriginIframes: boolean;
  checkoutEveryNms: number;
  maskAllInputs: boolean;
  maskInputOptions: Record<string, boolean>;
  maskInputFn: (text: string, element: HTMLElement | null) => string;
  blockClass: string;
  blockSelector: string;
  maskTextSelector: string;
  ignoreSelector: string;
  sampling: {
    mousemove: number;
    scroll: number;
    input: 'last';
    canvas?: 'all' | number;
  };
  slimDOMOptions: {
    script: boolean;
    comment: boolean;
    headFavicon: boolean;
    headMetaSocial: boolean;
    headMetaRobots: boolean;
    headMetaVerification: boolean;
  };
} {
  const canvasSampling: 'all' | number | undefined =
    preset.recordCanvas === 'fps' && preset.canvasFps !== null
      ? preset.canvasFps
      : preset.recordCanvas === 'snapshot'
        ? 'all'
        : undefined;

  return {
    inlineStylesheet: preset.inlineStylesheet,
    collectFonts: preset.collectFonts,
    inlineImages: preset.inlineImages,
    recordCanvas: preset.recordCanvas !== false,
    recordCrossOriginIframes: preset.recordCrossOriginIframes,
    checkoutEveryNms: preset.checkoutEveryNms,
    // Redaction default. Fidelity never overrides this — there is deliberately
    // no preset field that could turn it off (PLAN.md 4.6).
    /*
     * We take control of input masking rather than using rrweb's boolean.
     *
     * `maskAllInputs: true` is all-or-nothing, and rrweb has NO
     * `maskInputSelector` — its `maskInputFn` is only consulted when
     * `maskInputOptions` opens the gate for that input's tag or type. So the
     * gate is opened for every input type and the decision is made in our own
     * function, which is the only way `[data-record-mask]` can protect one
     * field while others are captured.
     *
     * This was silently broken before: an input carrying `data-record-mask`
     * had its value recorded in full, hidden by the global mask being on.
     */
    maskAllInputs: false,
    maskInputOptions: MASKABLE_INPUT_TYPES,
    maskInputFn: (text, element) => {
      if (maskAllInputs) return '*'.repeat(text.length);
      const marked =
        element !== null &&
        typeof element.matches === 'function' &&
        element.matches(MASK_INPUT_SELECTOR);
      return marked ? '*'.repeat(text.length) : text;
    },
    blockClass: BLOCK_CLASS,
    /*
     * App-declared exclusions. These are additive to the global input masking,
     * never a replacement for it — an app can always exclude MORE, never less.
     */
    blockSelector: BLOCK_SELECTOR,
    maskTextSelector: MASK_TEXT_SELECTOR,
    ignoreSelector: IGNORE_SELECTOR,
    sampling: {
      mousemove: preset.mousemoveSampleMs,
      scroll: preset.scrollSampleMs,
      input: 'last',
      ...(canvasSampling !== undefined ? { canvas: canvasSampling } : {}),
    },
    slimDOMOptions: {
      // Drop noise that cannot affect the replay's appearance. Scripts in
      // particular are pure weight: the replay never executes them.
      script: true,
      comment: true,
      headFavicon: true,
      headMetaSocial: true,
      headMetaRobots: true,
      headMetaVerification: true,
    },
  };
}

export function startDomCapture(
  preset: FidelityPreset,
  emit: (event: DomEvent) => void,
  maskAllInputs = true,
): DomCaptureHandle {
  const stop = record({
    ...buildRecordOptions(preset, maskAllInputs),
    emit: (event) => emit(event),
  });

  if (!stop) {
    throw new Error(
      'rrweb refused to start recording. The DOM may not be available yet.',
    );
  }

  return {
    stop,
    takeFullSnapshot: () => record.takeFullSnapshot(true),
  };
}
