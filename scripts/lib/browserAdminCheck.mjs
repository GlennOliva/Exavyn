#!/usr/bin/env node
/**
 * Run the gated Playwright admin spec in-process and report a HARD result.
 *
 * Credentials are handed to the child only via environment variables (never on
 * the command line, never written to disk, never logged). The E2E configuration
 * gate uses the exact string `'true'` the spec checks for, so the tests are not
 * silently skipped. The helper requires the full expected pass count with zero
 * skips/failures before it reports success.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './load-env.mjs';

/** tests/e2e/admin.exam.spec.ts contains exactly this many tests. */
const EXPECTED_PASSED = 2;

export function runAdminBrowserCheck(email, password) {
  const reportFile = join(tmpdir(), `pw-admin-${process.pid}-${Date.now()}.json`);
  let stdout = '';
  let status = 1;
  try {
    const run = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        'tests/e2e/admin.exam.spec.ts',
        '--project=chromium',
        '--reporter=json',
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'inherit'],
        encoding: 'utf8',
        env: {
          ...process.env,
          // The spec gates on exactly 'true'.
          E2E_SUPABASE_CONFIGURED: 'true',
          E2E_ADMIN_EMAIL: email,
          E2E_ADMIN_PASSWORD: password,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        },
      },
    );
    status = run.status ?? 1;
    stdout = run.stdout ?? '';
  } finally {
    // never leave the report (or anything) behind
  }

  let json;
  try {
    const text = readFileSync(reportFile, 'utf8');
    json = JSON.parse(text.slice(text.indexOf('{')));
  } catch {
    // Fallback: some Playwright versions only print JSON to stdout.
    try {
      json = JSON.parse(stdout.slice(stdout.indexOf('{')));
    } catch {
      rmSync(reportFile, { force: true });
      return {
        ok: false,
        reason:
          `no Playwright JSON report was produced (exit ${status}). ` +
          'The browser checks did not run to completion.',
      };
    }
  }
  rmSync(reportFile, { force: true });

  const counts = { passed: 0, skipped: 0, failed: 0, flaky: 0 };
  const lines = [];
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const st = t.status;
          lines.push(`  [${st}] ${suite.title} › ${spec.title}`);
          if (st === 'expected') counts.passed += 1;
          else if (st === 'skipped') counts.skipped += 1;
          else if (st === 'flaky') counts.flaky += 1;
          else counts.failed += 1;
        }
      }
      walk(suite.suites);
    }
  };
  walk(json.suites);

  const ok =
    counts.passed === EXPECTED_PASSED &&
    counts.skipped === 0 &&
    counts.failed === 0 &&
    counts.flaky === 0;

  return { ok, counts, lines, expected: EXPECTED_PASSED, exitStatus: status };
}
