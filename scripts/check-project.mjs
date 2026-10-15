#!/usr/bin/env node
/**
 * Project connectivity + schema check using ONLY browser-safe credentials.
 *
 * Loads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (from .env.local or the
 * process env), confirms the project is reachable, and probes the REST surface
 * for every expected table and RPC. It never prints key values and needs no
 * service-role key, so it is safe to run anywhere.
 *
 * Usage: node scripts/check-project.mjs
 * Exit codes: 0 = reachable (schema may still be absent), 1 = unreachable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TABLES = [
  'profiles', 'user_roles', 'courses', 'course_join_codes', 'enrollments',
  'exams', 'exam_versions', 'exam_questions', 'question_options', 'answer_keys',
  'exam_attempts', 'attempt_answers', 'violation_events', 'attempt_heartbeats',
  'audit_logs',
];

const RPCS = [
  'create_course', 'rotate_join_code', 'request_enrollment', 'decide_enrollment',
  'save_exam_draft', 'publish_exam', 'archive_exam', 'duplicate_exam',
  'start_attempt', 'acquire_attempt_controller', 'get_attempt_payload',
  'save_answer', 'record_violation', 'submit_attempt', 'get_result', 'heartbeat',
  'finalize_expired_attempts', 'admin_set_account_status', 'admin_set_role',
  'admin_dashboard_stats',
];

function loadEnvFile(name) {
  const file = path.join(ROOT, name);
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

const fileEnv = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local') };
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? fileEnv.VITE_SUPABASE_URL ?? '';
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? fileEnv.VITE_SUPABASE_ANON_KEY ?? '';

const mask = (v) => (v ? `<set:${v.length} chars>` : '<missing>');
let ref = '<unparseable>';
try {
  ref = new URL(url).host.replace(/\.supabase\.(co|in)$/, '');
} catch {
  /* leave default */
}

console.log('Configuration (values masked):');
console.log('  VITE_SUPABASE_URL      :', url ? new URL(url).origin : mask(url));
console.log('  project ref            :', ref);
console.log('  VITE_SUPABASE_ANON_KEY :', mask(anonKey));
console.log();

if (!url || !anonKey) {
  console.error('UNREACHABLE: URL or anon key is missing.');
  process.exit(1);
}

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
const timeout = () => AbortSignal.timeout(15000);

let reachable = false;
try {
  const res = await fetch(`${url}/auth/v1/health`, { headers, signal: timeout() });
  reachable = res.ok;
  console.log(`Auth health : ${res.status} ${res.ok ? '(reachable)' : ''}`);
} catch (err) {
  console.log(`Auth health : ERROR ${err.name}: ${err.message}`);
}

if (!reachable) {
  console.error('\nUNREACHABLE: could not reach the project. Check the URL and network.');
  process.exit(1);
}

async function probeTable(table) {
  try {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, { headers, signal: timeout() });
    return res.status;
  } catch {
    return 0;
  }
}

async function probeRpc(fn) {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
      signal: timeout(),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const missingTables = [];
for (const table of TABLES) {
  const status = await probeTable(table);
  const installed = status !== 404;
  if (!installed) missingTables.push(table);
  console.log(`  ${installed ? 'ok ' : 'MISSING'}  table  ${table}`);
}

const missingRpcs = [];
for (const fn of RPCS) {
  const status = await probeRpc(fn);
  const installed = status !== 404;
  if (!installed) missingRpcs.push(fn);
  console.log(`  ${installed ? 'ok ' : 'MISSING'}  rpc    ${fn}`);
}

console.log();
if (missingTables.length === 0 && missingRpcs.length === 0) {
  console.log(`SCHEMA: PRESENT on ${ref} (${TABLES.length} tables, ${RPCS.length} RPCs probed).`);
  console.log('404 here means "not found"; other statuses mean the object exists (auth/validation errors are expected without a signed-in user).');
} else {
  console.log(`SCHEMA: ABSENT/INCOMPLETE on ${ref}.`);
  if (missingTables.length) console.log(`  missing tables: ${missingTables.join(', ')}`);
  if (missingRpcs.length) console.log(`  missing RPCs:   ${missingRpcs.join(', ')}`);
  console.log('Apply migrations with the Supabase CLI (see docs/HOSTED_VERIFICATION.md).');
}
