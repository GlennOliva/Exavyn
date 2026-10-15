#!/usr/bin/env node
/**
 * Hidden-input prompt for provisioning scripts.
 *
 * Reads keystrokes from the controlling terminal in raw mode (which disables
 * the kernel's echo), so a typed or pasted secret is NEVER displayed and never
 * reaches shell history. The value is only ever held in memory by the caller;
 * this module never logs it.
 *
 * Throws if there is no TTY (e.g. CI or an agent tool call) so callers fail
 * loudly instead of reading an empty password.
 */
import readline from 'node:readline';

export function hasTty() {
  return Boolean(process.stdin.isTTY);
}

/**
 * Read a line with echo disabled. Returns the entered string (without the
 * trailing newline). Rejects if stdin is not a TTY or on Ctrl-C.
 */
export function promptHidden(query) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(
        new Error(
          'No terminal available for a hidden prompt. Run this script directly in your ' +
            'own terminal window (not through a non-interactive runner).',
        ),
      );
      return;
    }

    stdout.write(query);

    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true); // disables tty echo + canonical mode
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    let inEscape = false; // swallowing an ANSI escape sequence

    const finish = (err) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.codePointAt(0) ?? 0;
        if (inEscape) {
          // An escape sequence ends at the first byte in 0x40..0x7e.
          if (code >= 0x40 && code <= 0x7e) inEscape = false;
          continue;
        }
        if (ch === '\u001b') {
          inEscape = true;
          continue;
        }
        if (ch === '\r' || ch === '\n' || code === 0x04 /* Ctrl-D */) {
          finish(null);
          return;
        }
        if (code === 0x03) {
          // Ctrl-C
          finish(new Error('Cancelled.'));
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // Backspace / Delete
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (code < 0x20) continue; // ignore other control characters
        value += ch;
      }
    };

    stdin.on('data', onData);
  });
}

export function promptVisible(query, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${query}${suffix} `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}
