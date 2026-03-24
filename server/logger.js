// ─────────────────────────────────────────────────────────────────────────────
// LOGGER UTILITY
// Wraps console methods with timestamps, log levels, and namespaced prefixes.
//
// Usage:
//   import { createLogger } from './logger.js';
//   const log = createLogger('pdf');
//   log.info('Extracted 3 pages');
//   log.error('Parse failed', err);
//
// Log level is controlled via LOG_LEVEL env var (default: 'info').
// Set LOG_LEVEL=debug in .env to see verbose output.
// ─────────────────────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS = {
  debug: '\x1b[36m',  // cyan
  info:  '\x1b[32m',  // green
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
};

const activeLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function formatMessage(level, namespace, message) {
  const ts = new Date().toISOString();
  const color = COLORS[level];
  const reset = COLORS.reset;
  return `${color}[${ts}] [${level.toUpperCase().padEnd(5)}] [${namespace}]${reset} ${message}`;
}

function log(level, namespace, message, ...args) {
  if (LEVELS[level] < activeLevel) return;

  const formatted = formatMessage(level, namespace, message);

  switch (level) {
    case 'error': console.error(formatted, ...args); break;
    case 'warn':  console.warn(formatted,  ...args); break;
    default:      console.log(formatted,   ...args); break;
  }
}

/**
 * Creates a namespaced logger.
 * @param {string} namespace - Label shown in every log line (e.g. 'pdf', 'agent', 'api')
 */
export function createLogger(namespace) {
  return {
    /** Verbose details useful during development — hidden in production */
    debug: (msg, ...args) => log('debug', namespace, msg, ...args),
    /** Normal operational messages */
    info:  (msg, ...args) => log('info',  namespace, msg, ...args),
    /** Non-fatal unexpected states */
    warn:  (msg, ...args) => log('warn',  namespace, msg, ...args),
    /** Failures that need attention */
    error: (msg, ...args) => log('error', namespace, msg, ...args),
  };
}
