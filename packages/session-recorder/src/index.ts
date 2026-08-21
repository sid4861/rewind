export { SessionRecorder } from './widget/SessionRecorderWidget';
export type { SessionRecorderProps } from './widget/SessionRecorderWidget';

export { createSessionRecorder } from './core/recorder';
export type {
  SessionRecorder as SessionRecorderInstance,
  RecorderSnapshot,
  RecorderStatus,
  TesterDetails,
} from './core/recorder';

export type { RecorderConfig, RecorderLimits } from './config';
export type { BuiltArchive } from './core/archive';
export {
  BLOCK_CLASS,
  BLOCK_SELECTOR,
  IGNORE_SELECTOR,
  MASK_INPUT_SELECTOR,
  MASK_TEXT_SELECTOR,
  RECORDER_NAME,
  RECORDER_VERSION,
} from './constants';
