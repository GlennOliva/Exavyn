#!/usr/bin/env node
/**
 * Shared harness for hosted verification suites.
 *
 * Responsibilities:
 *   - Load browser-safe + server-only configuration without ever logging secrets.
 *   - Build Supabase clients (publishable anon key for real user tokens, service
 *     role only for fixture setup that must bypass RLS).
 *   - A tiny PASS/FAIL runner and assertions.
 *   - Fixture manifest + best-effort cleanup.
 *
 * SECURITY: never print SUPABASE_SERVICE_ROLE_KEY, tokens, or passwords. Callers
 * must keep secrets out of check names and error messages.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from '../../../scripts/lib/load-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');
export const FIXTURE_DIR = path.join(ROOT, 'supabase', 'tests', '.fixtures');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
/**
 * Populate process.env from local env files. Server-only secrets are read from
 * the gitignored `.env.server.local`, then browser-safe `.env.local` / `.env`.
 * Never overrides real env vars. See scripts/lib/load-env.mjs.
 */
export function loadEnv() {
  loadEnvFiles(['.env.server.local', '.env.local', '.env'], { root: ROOT });
}

export function config() {
  loadEnv();
  return {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  };
}

/**
 * Exit early (code 2) with an actionable message when hosted configuration is
 * missing — a blocked run is not a failed run.
 */
export function requireConfig({ service = false } = {}) {
  const cfg = config();
  const missing = [];
  if (!cfg.url) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!cfg.anonKey) missing.push('SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)');
  if (service && !cfg.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error('BLOCKED: hosted configuration is incomplete.');
    console.error('Missing:\n  - ' + missing.join('\n  - '));
    console.error('Nothing was executed. See docs/HOSTED_VERIFICATION.md.');
    process.exit(2);
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
export function serviceClient(cfg = config()) {
  return createClient(cfg.url, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(cfg = config()) {
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anon-key client signed in as a real user (RLS is evaluated for this token). */
export async function signIn(cfg, email, password) {
  const client = anonClient(cfg);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// Fixture helpers (service role; bypasses RLS — setup only)
// ---------------------------------------------------------------------------
export function shortId() {
  return randomBytes(4).toString('hex');
}

export async function createUser(service, email, fullName, password) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

/** Directly (un)assign a trusted role. Used to bootstrap the first admin only. */
export async function setRole(service, userId, role) {
  const { error } = await service
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id' });
  if (error) throw new Error(`setRole ${role}: ${error.message}`);
}

export function buildExamPayload({
  courseId,
  title,
  questionCount = 50,
  resultRelease = 'immediate',
  answerReview = 'immediate',
  passThreshold = null,
  maxAttempts = 1,
  opensInMs = -60_000,
  closesInMs = 7 * 24 * 60 * 60 * 1000,
  durationMinutes = 60,
  questionRandomization = false,
  optionRandomization = false,
}) {
  const now = Date.now();
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    prompt: `${title} — Question ${i + 1}: select the correct choice.`,
    points: 1,
    correct_index: i % 4,
    options: [0, 1, 2, 3].map((k) => ({ label: `${title} Q${i + 1} choice ${k + 1}` })),
  }));
  return {
    course_id: courseId,
    title,
    instructions: 'Answer every question. One attempt only. No tolerance for leaving the exam.',
    duration_minutes: durationMinutes,
    opens_at: new Date(now + opensInMs).toISOString(),
    closes_at: new Date(now + closesInMs).toISOString(),
    question_randomization: questionRandomization,
    option_randomization: optionRandomization,
    result_release: resultRelease,
    answer_review: answerReview,
    pass_threshold: passThreshold,
    max_attempts: maxAttempts,
    questions,
  };
}

/** question_id -> correct_option_id for a published version (grader-side only). */
export async function fetchKeyMap(service, versionId) {
  const { data: questions, error } = await service
    .from('exam_questions')
    .select('id')
    .eq('version_id', versionId);
  if (error) throw new Error(`fetchKeyMap questions: ${error.message}`);
  const ids = (questions ?? []).map((q) => q.id);
  if (ids.length === 0) return {};
  const { data: keys, error: keyErr } = await service
    .from('answer_keys')
    .select('question_id,correct_option_id')
    .in('question_id', ids);
  if (keyErr) throw new Error(`fetchKeyMap keys: ${keyErr.message}`);
  return Object.fromEntries((keys ?? []).map((k) => [k.question_id, k.correct_option_id]));
}

export async function setDeadline(service, attemptId, iso) {
  const { error } = await service
    .from('exam_attempts')
    .update({ deadline_at: iso })
    .eq('id', attemptId);
  if (error) throw new Error(`setDeadline: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Runner + assertions
// ---------------------------------------------------------------------------
export function createRunner(label) {
  const state = { label, total: 0, failed: 0, failures: [] };
  return {
    get state() {
      return state;
    },
    async check(name, fn) {
      state.total += 1;
      try {
        await fn();
        console.log(`  PASS  ${name}`);
      } catch (err) {
        state.failed += 1;
        state.failures.push({ name, message: err.message });
        console.error(`  FAIL  ${name}\n        ${err.message}`);
      }
    },
    report() {
      console.log(`\n${state.label}: ${state.total - state.failed}/${state.total} checks passed.`);
      if (state.failed > 0) {
        console.error('Failures:');
        for (const f of state.failures) console.error(`  - ${f.name}: ${f.message}`);
      }
      return state;
    },
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

export function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message ?? error}`);
}

export function assertRpcError(result, context) {
  if (!result.error) throw new Error(`${context}: expected an error but call succeeded`);
}

// ---------------------------------------------------------------------------
// Manifest + cleanup
// ---------------------------------------------------------------------------
export function saveManifest(runId, data) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = path.join(FIXTURE_DIR, `${runId}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/**
 * Best-effort teardown. Immutability triggers intentionally forbid deleting
 * published versions, finalized attempts, and violation events, so some
 * artifacts cannot be removed. This returns the list of leftovers rather than
 * pretending the run was clean.
 */
export async function bestEffortCleanup({ service, courses = [], users = [] }) {
  const leftovers = [];
  for (const courseId of courses) {
    await service.from('enrollments').delete().eq('course_id', courseId);
    await service.from('course_join_codes').delete().eq('course_id', courseId);

    const { data: exams } = await service.from('exams').select('id').eq('course_id', courseId);
    for (const exam of exams ?? []) {
      const { error } = await service.from('exams').delete().eq('id', exam.id);
      if (error) leftovers.push(`exam ${exam.id}: ${error.message}`);
    }
    const { error: courseErr } = await service.from('courses').delete().eq('id', courseId);
    if (courseErr) leftovers.push(`course ${courseId}: ${courseErr.message}`);
  }
  for (const userId of users) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) leftovers.push(`user ${userId}: ${error.message}`);
  }
  return leftovers;
}

export function reportLeftovers(leftovers) {
  if (leftovers.length === 0) {
    console.log('\nCleanup: all non-immutable fixtures removed.');
    return;
  }
  console.log(
    `\nCleanup: ${leftovers.length} immutable artifact(s) remain (by design). ` +
      'Reuse a dedicated test project or reset the local database to clear them.',
  );
  for (const item of leftovers) console.log(`  - ${item}`);
}
