#!/usr/bin/env node
/**
 * Shared dotenv-style loader for server-side scripts.
 *
 * Loads `.env.server.local` (server-only secrets, gitignored), then `.env.local`
 * (browser-safe config, shared with Vite), then `.env`. Real process environment
 * always wins, so an inline `VAR=... node ...` export is never overridden.
 *
 * SECURITY: this module only reads files into `process.env`. It never logs
 * values. Never import it from frontend code (anything under `src/`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (this file lives at <root>/scripts/lib/load-env.mjs). */
export const ROOT = path.resolve(here, '..', '..');

export function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Load one or more env files into `process.env` (first definition wins unless
 * `override` is set). Returns the list of files that actually existed.
 */
export function loadEnvFiles(files, { root = ROOT, override = false } = {}) {
  const loaded = [];
  for (const name of files) {
    const file = path.isAbsolute(name) ? name : path.join(root, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(file))) {
      // A key present with an empty value means "not configured"; skip it so it
      // neither overrides a real value nor defeats `?? default` fallbacks.
      if (value === '') continue;
      if (override || !(key in process.env)) process.env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Server-only view: secrets may appear; use for Node scripts/tests only. */
export function loadServerEnv(options) {
  return loadEnvFiles(['.env.server.local', '.env.local', '.env'], options);
}

/** Browser-safe view only (no server secrets). */
export function loadBrowserEnv(options) {
  return loadEnvFiles(['.env.local', '.env'], options);
}
