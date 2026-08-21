import { useEffect } from 'react';

/**
 * Keyboard control for the player.
 *
 * A developer scrubbing through a session reaches for space and arrow keys
 * without thinking, and having to aim at a 32px button every time is the
 * difference between a tool people use and one they tolerate.
 *
 * Every handler bails out while focus is in a text field — otherwise typing a
 * filter query pauses playback on the first space, which feels broken.
 */

export interface ShortcutActions {
  togglePlay(): void;
  step(deltaMs: number): void;
  nextError(): void;
  previousError(): void;
  focusFilter(): void;
  toggleFullscreen(): void;
  cycleSpeed(direction: 1 | -1): void;
}

const SMALL_STEP_MS = 100;
const LARGE_STEP_MS = 5000;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useShortcuts(actions: ShortcutActions, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      // `/` and `f` still work from a text field so a developer can jump
      // between filters, but nothing else fires while they are typing.
      const typing = isTypingTarget(event.target);

      if (event.key === 'Escape' && typing) {
        (event.target as HTMLElement).blur();
        return;
      }

      if (typing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case ' ':
          // Space also activates a focused button; preventing default is what
          // stops it doing both.
          event.preventDefault();
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          actions.step(event.shiftKey ? -LARGE_STEP_MS : -SMALL_STEP_MS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          actions.step(event.shiftKey ? LARGE_STEP_MS : SMALL_STEP_MS);
          break;
        case 'e':
          event.preventDefault();
          if (event.shiftKey) actions.previousError();
          else actions.nextError();
          break;
        case 'f':
        case '/':
          event.preventDefault();
          actions.focusFilter();
          break;
        case 'F':
          event.preventDefault();
          actions.toggleFullscreen();
          break;
        case '>':
        case '.':
          event.preventDefault();
          actions.cycleSpeed(1);
          break;
        case '<':
        case ',':
          event.preventDefault();
          actions.cycleSpeed(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, enabled]);
}

export const SHORTCUT_HELP: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['← →', 'Step 100ms'],
  ['Shift ← →', 'Step 5s'],
  ['e', 'Next error'],
  ['Shift e', 'Previous error'],
  ['f  /', 'Focus filter'],
  ['Shift f', 'Fullscreen'],
  [', .', 'Slower / faster'],
];
