#!/usr/bin/env node
/**
 * Verify an administrator account can sign in and acts as an admin.
 *
 * Use this after removing BOOTSTRAP_ADMIN_TOKEN to confirm the previously
 * provisioned admin is unaffected. The password is entered through a HIDDEN
 * terminal prompt — never printed, never written to disk, never in shell history.
 *
 * Usage:
 *   node scripts/verify-admin-login.mjs [--email admin@gmail.com] [--browser]
 *
 *   --browser  also run the Playwright check that signs in through the UI and
 *              asserts the app routes the account to /admin.
 */
import { createClient } from '@supabase/supabase-js';
import { loadServerEnv } from './lib/load-env.mjs';
import { promptHidden } from './lib/prompt.mjs';
import { runAdminBrowserCheck } from './lib/browserAdminCheck.mjs';

loadServerEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const email = (typeof args.email === 'string' ? args.email : 'admin@gmail.com').trim().toLowerCase();

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url || !anonKey) fail('SUPABASE_URL and SUPABASE_ANON_KEY are required.');

let password;
try {
  password = await promptHidden(`Password for ${email}: `);
} catch (err) {
  fail(err?.message ?? String(err));
}
if (!password) fail('No password entered.');

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signIn.user) fail(`sign-in failed: ${signInError?.message}`);

  const { data: roleRow, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', signIn.user.id)
    .maybeSingle();
  if (roleError) fail(`role read failed: ${roleError.message}`);
  const roleOk = roleRow?.role === 'admin';

  const { error: rpcError } = await client.rpc('admin_dashboard_stats');
  const adminOk = !rpcError;

  await client.auth.signOut();

  console.log('\nVerification');
  console.log('  email              :', email);
  console.log('  sign-in            :', signIn.user ? '✓' : '✗');
  console.log('  role               :', roleRow?.role ?? '(none)', roleOk ? '✓' : '✗ expected admin');
  console.log('  admin-only RPC      :', adminOk ? '✓ admin_dashboard_stats allowed' : `✗ ${rpcError?.message}`);

  if (!roleOk || !adminOk) fail('Administrator verification failed.');

  if (args.browser) {
    console.log('\nRunning browser check (Playwright, chromium) …');
    const result = runAdminBrowserCheck(email, password);
    if (result.lines) for (const line of result.lines) console.log(line);
    if (!result.ok) {
      if (result.reason) fail(`Browser verification: ${result.reason}`);
      const c = result.counts;
      fail(
        'Browser verification did not fully pass: expected ' +
          `${result.expected} passed / 0 skipped, got ${c.passed} passed, ` +
          `${c.skipped} skipped, ${c.failed} failed, ${c.flaky} flaky.`,
      );
    }
    console.log(`  browser: ${result.counts.passed}/${result.expected} passed, 0 skipped ✓`);
  }

  console.log(`\n✓ ${email} signs in and has administrator access.\n`);
}

main().catch((err) => fail(err?.message ?? String(err)));
