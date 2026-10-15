#!/usr/bin/env node
/**
 * Server-side, administrator-created user provisioning.
 *
 * Creates (or reuses) a CONFIRMED user with the given role using the service
 * role key, then verifies that the account can actually sign in and holds the
 * expected role. Useful for creating a confirmed student (or teacher) account
 * WITHOUT relying on the public email-verification flow, which is subject to
 * the project's email send rate limit.
 *
 * Public self-registration always creates a *student*; this script exists for
 * the administrator side of that split. Administrators should normally be
 * created with `scripts/provision-admin.mjs` (the bootstrap-admin function);
 * this script refuses `--role admin` to keep the audited path authoritative.
 *
 * Usage:
 *   node scripts/provision-user.mjs --email student9@exam.test --role student \
 *        [--name "Student Nine"] [--password X]
 *
 * The password is read from (in order): --password, $PROVISION_PASSWORD, or a
 * hidden terminal prompt (entered twice). It is never printed or logged.
 *
 * Required env (usually from the gitignored .env.server.local):
 *   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) for the sign-in check.
 */
import { createClient } from '@supabase/supabase-js';
import { loadServerEnv } from './lib/load-env.mjs';
import { hasTty, promptHidden } from './lib/prompt.mjs';

loadServerEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
const role = typeof args.role === 'string' ? args.role : 'student';
const fullName =
  typeof args.name === 'string' ? args.name : email ? email.split('@')[0] : 'User';

const ALLOWED_ROLES = ['student', 'teacher'];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (!email) fail('--email is required.');
if (!ALLOWED_ROLES.includes(role)) {
  fail(
    `--role must be one of: ${ALLOWED_ROLES.join(', ')}. ` +
      'For administrators use scripts/provision-admin.mjs (audited bootstrap path).',
  );
}

async function readPassword() {
  if (typeof args.password === 'string' && args.password) return args.password;
  if (process.env.PROVISION_PASSWORD) return process.env.PROVISION_PASSWORD;
  const p1 = await promptHidden(`Password for ${email}: `);
  const p2 = await promptHidden('Confirm password: ');
  if (p1 !== p2) fail('Passwords did not match.');
  return p1;
}

let password;
try {
  password = await readPassword();
} catch (err) {
  fail(err?.message ?? String(err));
}
if (!password || password.length < 8) fail('Password must be at least 8 characters.');

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonKeyFinal = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

async function main() {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) fail(`listUsers: ${listError.message}`);
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);

  let userId;
  let created;
  if (existing) {
    userId = existing.id;
    created = false;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) fail(`updateUserById: ${error.message}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) fail(`createUser: ${error?.message ?? 'no user returned'}`);
    userId = data.user.id;
    created = true;
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, email, full_name: fullName, status: 'active' });
  if (profileError) fail(`profile upsert: ${profileError.message}`);

  const { error: roleError } = await admin
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id' });
  if (roleError) fail(`role upsert: ${roleError.message}`);

  // Verify the account can actually authenticate and carries the role.
  if (!anonKeyFinal) fail('SUPABASE_ANON_KEY is required to verify sign-in.');
  const client = createClient(url, anonKeyFinal, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signIn.user) fail(`sign-in verification failed: ${signInError?.message}`);

  const { data: roleRow, error: roleReadError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (roleReadError) fail(`role read failed: ${roleReadError.message}`);

  await client.auth.signOut();

  const roleOk = roleRow?.role === role;
  console.log('\nProvisioning result');
  console.log('  email        :', email);
  console.log('  user id      :', userId);
  console.log('  account      :', created ? 'created (confirmed)' : 'reused (password refreshed)');
  console.log('  role         :', roleRow?.role ?? '(none)', roleOk ? '✓' : '✗ expected ' + role);
  console.log('  sign-in      :', signIn.user ? '✓ verified' : '✗ failed');

  if (!roleOk) fail('Role does not match the requested value.');
  console.log('\n✓ Done. The account can sign in immediately (email already confirmed).\n');
}

main().catch((err) => fail(err?.message ?? String(err)));
