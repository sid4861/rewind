export const RECORDER_NAME = '@rewind/session-recorder';
export const RECORDER_VERSION = '0.0.0';

/**
 * rrweb blocks any subtree carrying this class. The widget's host element wears
 * it so the recorder never records its own UI — without this you get a replay
 * of a replay control, which is confusing and makes testers think the tool is
 * broken.
 *
 * Note the honest limitation: rrweb replaces a blocked element with a
 * same-sized placeholder, so the replay shows an empty rectangle where the
 * widget was rather than nothing at all. The host element is kept small and
 * fixed-position to keep that rectangle out of the way.
 */
export const BLOCK_CLASS = 'rewind-recorder-block';

/*
 * Escape hatches an application uses to mark its own sensitive regions.
 *
 * The built-in denylists cover credentials, which are predictable. They cannot
 * know that a particular panel shows a customer's medical notes, or that one
 * widget renders a third-party value nobody should archive. These attributes
 * are how an app says so, without needing a recorder release.
 *
 * Attributes rather than classes: a class is styling, and someone will
 * eventually "clean up" an unused-looking one. `data-record-block` reads as
 * intent and survives a refactor.
 */

/** Replaced with a placeholder box; contents never captured. */
export const BLOCK_SELECTOR = '[data-record-block]';
/** Captured, but all text replaced with asterisks. */
export const MASK_TEXT_SELECTOR = '[data-record-mask]';
/** Input values never captured, even beyond the global input masking. */
export const MASK_INPUT_SELECTOR = '[data-record-mask]';
/**
 * Suppresses INPUT EVENTS from a field. It does not remove content.
 *
 * Verified against rrweb's source rather than assumed: `ignoreSelector` is
 * consulted only inside its input observer, so it stops keystroke and change
 * events being emitted for a matching field. The element itself, and the rest
 * of the page, are captured normally.
 *
 * Values are already masked globally, so this adds one thing: it hides the fact
 * that the user typed at all. Useful where even the timing or existence of
 * input is sensitive. To exclude CONTENT, use `data-record-block`.
 */
export const IGNORE_SELECTOR = '[data-record-ignore]';

export const WIDGET_HOST_ID = 'rewind-session-recorder-host';

export const STORAGE_KEYS = {
  position: 'rewind:widget-position',
  tester: 'rewind:tester',
} as const;
