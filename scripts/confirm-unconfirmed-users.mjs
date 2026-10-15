#!/usr/bin/env node
/**
 * Enable sign-in for pre-existing UNCONFIRMED accounts — safely.
 *
 * When email confirmation is (or was) enabled, a self-signup that never clicked
 * the emailed link leaves a user with `email_confirmed_at = null`. Disabling the
 * "Confirm email" setting lets those accounts sign in again, but an operator may
 * also want to explicitly mark them confirmed.
 *
 * This script is the ONLY sanctioned way to do that: it calls the Supabase admin
 * API with `email_confirm: true`, which
 *   - never deletes an account,
 *   - never changes or resets a password,
 *   - never grants a role (roles are owned by the `user_roles` trigger/RPCs).
 *
 * It is READ-ONLY unless you pass `--apply`.
 *
 * Usage:
 *   node scripts/confirm-unconfirmed-users.mjs            # dry run (default)
 *   node scripts/confirm-unconfirmed-users.mjs --apply    # confirm them
 *
 * Required env (usually from the gitignored .env.server.local):
 *   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes: 0 ok, 1 failure, 2 blocked (missing credentials).
 */
import { createClient } from '@supabase/supabase-js';
import { loadServerEnv } from './lib/load-env.mjs';

loadServerEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes('--apply');

if (!url || !serviceKey) {
  console.error(
    'BLOCKED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required ' +
      '(set them in .env.server.local or export them).',
  );
  process.exit(2);
}

function mask(email) {
  if (!email) return '(no email)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function rolesFor(ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from('user_roles').select('user_id, role').in('user_id', ids);
  if (error) throw new Error(`user_roles read: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.user_id, row.role]));
}

async function main() {
  const users = await listAllUsers();
  const unconfirmed = users.filter((u) => !u.email_confirmed_at);

  console.log(`Scanned ${users.length} account(s); ${unconfirmed.length} unconfirmed.`);
  if (unconfirmed.length === 0) {
    console.log('Nothing to do — every existing account is already confirmed. No accounts changed.');
    return;
  }

  const roles = await admin
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', unconfirmed.map((u) => u.id));
  const roleByUser = new Map((roles.data ?? []).map((r) => [r.user_id, r.role]));

  console.log('Unconfirmed accounts:');
  for (const u of unconfirmed) {
    const role = roleByUser.get(u.id) ?? '(no role)';
    console.log(`  - ${mask(u.email)}  [${role}]  ${u.id}`);
  }

  if (!apply) {
    console.log(
      '\nDry run. Re-run with --apply to set email_confirm=true for these accounts\n' +
        '(password and role untouched; no accounts deleted).',
    );
    return;
  }

  let confirmed = 0;
  let failed = 0;
  for (const u of unconfirmed) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
    if (error) {
      console.log(`  x ${mask(u.email)}: ${error.message}`);
      failed += 1;
    } else {
      console.log(`  ok ${mask(u.email)} confirmed`);
      confirmed += 1;
    }
  }
  console.log(`\nDone. Confirmed ${confirmed}; failed ${failed}. No accounts deleted; no passwords changed.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
