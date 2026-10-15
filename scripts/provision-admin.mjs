#!/usr/bin/env node
/**
 * Administrator provisioning via the audited `bootstrap-admin` Edge Function.
 *
 * This is the ONLY sanctioned path that grants the admin role. It posts the
 * BOOTSTRAP_ADMIN_TOKEN + chosen credentials to the deployed function, then
 * verifies the resulting account (sign-in, role, and an admin-only RPC).
 *
 * The password is entered through a HIDDEN terminal prompt and never printed,
 * never written to disk, never placed in frontend code, and never committed.
 *
 * Prerequisites (one-time):
 *   npx supabase secrets set BOOTSTRAP_ADMIN_TOKEN=<long-random-string>
 * (the value must also be present in the gitignored `.env.server.local`).
 *
 * Usage:
 *   node scripts/provision-admin.mjs [--email admin@gmail.com] [--name "Administrator"]
 *                                   [--browser]
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bootstrapToken = process.env.BOOTSTRAP_ADMIN_TOKEN;

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
const fullName = typeof args.name === 'string' ? args.name : 'Administrator';

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url) fail('SUPABASE_URL is required (from .env.server.local).');
if (!bootstrapToken) {
  fail(
    'BOOTSTRAP_ADMIN_TOKEN is empty. Set it once with:\n' +
      '    npx supabase secrets set BOOTSTRAP_ADMIN_TOKEN=<long-random-string>\n' +
      '  and add the same value to the gitignored .env.server.local.',
  );
}

let password;
try {
  const p1 = await promptHidden(`Password for ${email}: `);
  const p2 = await promptHidden('Confirm password: ');
  if (p1 !== p2) fail('Passwords did not match.');
  password = p1;
} catch (err) {
  fail(err?.message ?? String(err));
}
if (password.length < 8) fail('Password must be at least 8 characters.');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`\nCalling bootstrap-admin for ${email} …`);
  const res = await fetch(`${url}/functions/v1/bootstrap-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey ?? '' },
    body: JSON.stringify({ token: bootstrapToken, email, password, full_name: fullName }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    fail(`bootstrap-admin failed (HTTP ${res.status}): ${body.error ?? 'unknown error'}`);
  }
  console.log(`  ${body.created ? 'created' : 'reused'} user_id=${body.user_id}`);

  if (!anonKey) fail('SUPABASE_ANON_KEY is required to verify sign-in.');
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signIn.user) fail(`sign-in verification failed: ${signInError?.message}`);

  const { data: roleRow, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', body.user_id)
    .maybeSingle();
  if (roleError) fail(`role read failed: ${roleError.message}`);
  const roleOk = roleRow?.role === 'admin';

  const { error: rpcError } = await client.rpc('admin_dashboard_stats');
  const adminOk = !rpcError;

  await client.auth.signOut();

  console.log('\nVerification');
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

  console.log(`\n✓ Administrator ready: ${email}\n`);
}

main().catch((err) => fail(err?.message ?? String(err)));
