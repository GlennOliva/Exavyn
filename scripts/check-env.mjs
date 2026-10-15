#!/usr/bin/env node
/**
 * Environment presence check for server-side verification.
 *
 * Loads `.env.server.local` (gitignored secrets), then `.env.local`, then `.env`
 * — exactly as the test suites do — and reports which variables are present.
 *
 * It NEVER prints a value: only file paths, character counts, and the project
 * origin (a URL, not a secret). Safe to run and safe to paste into a report.
 *
 * Usage: node scripts/check-env.mjs   (or: npm run check:env)
 */
import path from 'node:path';
import { loadEnvFiles, ROOT } from './lib/load-env.mjs';

const loaded = loadEnvFiles(['.env.server.local', '.env.local', '.env'], { root: ROOT });

const status = (name) => {
  const v = process.env[name];
  return v ? `PRESENT (${v.length} chars)` : 'absent';
};
const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '<unparseable>';
  }
};
const firstOf = (...names) => names.map((n) => process.env[n]).find((v) => v) ?? '';

const projectRef = (() => {
  const u = firstOf('SUPABASE_URL', 'VITE_SUPABASE_URL');
  try {
    return new URL(u).host.replace(/\.supabase\.(co|in)$/, '');
  } catch {
    return '<none>';
  }
})();

console.log('Env files loaded (paths only, values never printed):');
if (loaded.length === 0) console.log('  (none found)');
for (const f of loaded) console.log('  -', path.relative(ROOT, f));

const EXPECTED_REF = 'tddmtdhhckykwnoydvjc';
console.log('\nTarget project ref:', projectRef);
console.log(
  '  expected (anti_cheat): ' +
    EXPECTED_REF +
    (projectRef === EXPECTED_REF ? '  ✓ match' : '  ✗ MISMATCH'),
);

const groups = [
  {
    title: 'Project connection — required by hosted suites + seed',
    rows: [
      ['SUPABASE_URL (or VITE_SUPABASE_URL)', () => {
        const v = firstOf('SUPABASE_URL', 'VITE_SUPABASE_URL');
        return v ? `PRESENT  ${origin(v)}` : 'absent';
      }],
      ['SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)', () => {
        const v = firstOf('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
        return v ? `PRESENT (${v.length} chars)` : 'absent';
      }],
      ['SUPABASE_SERVICE_ROLE_KEY', () => status('SUPABASE_SERVICE_ROLE_KEY')],
      ['SEED_PASSWORD', () => status('SEED_PASSWORD')],
    ],
  },
  {
    title: 'Supabase CLI — npx supabase',
    rows: [
      ['SUPABASE_ACCESS_TOKEN', () => status('SUPABASE_ACCESS_TOKEN')],
      ['SUPABASE_DB_PASSWORD', () => status('SUPABASE_DB_PASSWORD')],
    ],
  },
  {
    title: 'One-time administrator bootstrap',
    rows: [['BOOTSTRAP_ADMIN_TOKEN', () => status('BOOTSTRAP_ADMIN_TOKEN')]],
  },
  {
    title: 'Authenticated browser tests — optional',
    rows: [
      ['E2E_SUPABASE_CONFIGURED', () => status('E2E_SUPABASE_CONFIGURED')],
      ['E2E_STUDENT_EMAIL', () => status('E2E_STUDENT_EMAIL')],
      ['E2E_STUDENT_PASSWORD', () => status('E2E_STUDENT_PASSWORD')],
      ['E2E_EXAM_ID', () => status('E2E_EXAM_ID')],
      ['E2E_BASE_URL', () => process.env.E2E_BASE_URL || '(default http://localhost:5177)'],
    ],
  },
];

for (const group of groups) {
  console.log('\n' + group.title + ':');
  for (const [label, fn] of group.rows) {
    console.log('  ' + label.padEnd(48) + fn());
  }
}

const haveService = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const haveAccess = Boolean(process.env.SUPABASE_ACCESS_TOKEN);
const haveDbPass = Boolean(process.env.SUPABASE_DB_PASSWORD);

console.log(
  '\nHosted suites + seeder: ' +
    (haveService
      ? 'READY (service-role present) for workflow/concurrency/finality + seed'
      : 'BLOCKED for workflow/concurrency/finality + seed (set SUPABASE_SERVICE_ROLE_KEY); ' +
        'test:rls and the live lifecycle run with user tokens only'),
);
console.log(
  'Supabase CLI — Management API (projects/functions/secrets list): ' +
    (haveAccess
      ? 'READY (access token present)'
      : 'env token absent — still OK if `npx supabase login` stored a session; otherwise BLOCKED'),
);
console.log(
  'Supabase CLI — DB connection (migration list --linked / db push|pull): ' +
    (haveDbPass ? 'READY (db password present)' : 'BLOCKED (set SUPABASE_DB_PASSWORD; command hangs at the prompt)'),
);
console.log(
  'Authenticated browser tests: ' +
    (process.env.E2E_SUPABASE_CONFIGURED && process.env.E2E_STUDENT_EMAIL && process.env.E2E_STUDENT_PASSWORD
      ? 'READY (student creds present)'
      : 'will SKIP (optional; set E2E_SUPABASE_CONFIGURED + student creds to enable)'),
);
