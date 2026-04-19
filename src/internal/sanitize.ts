/**
 * Internal helpers for neutralising terminal-control and log-injection
 * sequences in untrusted strings before they reach stdout, stderr or a
 * line-oriented log file.
 *
 *  - ANSI CSI/SGR sequences (`\x1B[...`)
 *  - ANSI OSC sequences, incl. hyperlinks and window-title escapes
 *    (`\x1B]...\x07` and `\x1B]...\x1B\\`)
 *  - Raw C0/C1 control characters except `\t`
 *  - CR/LF splicing in line-oriented transports
 */

// Matches CSI (ESC [ ...final), OSC (ESC ]...ST|BEL), and single-char escapes.
// The patterns are linear in input length; no nested quantifiers (ReDoS-safe).
const ANSI_PATTERN = new RegExp(
  [
    '\\u001B\\[[0-?]*[ -/]*[@-~]', // CSI
    '\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)', // OSC … BEL | ESC \
    '\\u001B[@-Z\\\\-_]', // 2-char C1 escape
  ].join('|'),
  'g',
);

// C0/C1 controls except TAB (\t). Covers NUL, backspace, form feed, etc.
// CR/LF are handled separately so line-oriented transports can escape them
// rather than simply strip them.
const CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Strip ANSI escape sequences and C0/C1 control characters from a string.
 * CR/LF are preserved — use `escapeCrLf` if the consumer is line-oriented.
 */
export function stripAnsiAndControls(value: string): string {
  return value.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '');
}

/**
 * Replace CR and LF with their escaped literal forms so a forged log line
 * cannot be spliced into a downstream line-based consumer.
 */
export function escapeCrLf(value: string): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

/**
 * Full neutralisation for line-oriented text transports (dev-mode, file).
 * JSON transports don't need this — `JSON.stringify` already escapes
 * control chars.
 */
export function neutralizeForLineOutput(value: string): string {
  return escapeCrLf(stripAnsiAndControls(value));
}
