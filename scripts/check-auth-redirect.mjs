#!/usr/bin/env node
/**
 * Verify the hosted Supabase Auth redirect allowlist without sending email.
 *
 * Generates implicit recovery links with the Admin API for the supplied test
 * account and reports only the redirect origin/path. It never prints action
 * links or tokens. The generated one-time tokens invalidate any earlier unused
 * recovery token for that account, so pass a disposable test address.
 *
 * Usage:
 *   npm run check:auth-redirect -- student@exam.test
 *   npm run check:auth-redirect -- student@exam.test https://example.com/update-password
 *
 * Exit codes: 0 = configured as expected, 1 = fallback/mismatch, 2 = usage/env.
 */
import { loadServerEnv } from './lib/load-env.mjs';
import { createClient } from '@supabase/supabase-js';

loadServerEnv();

const email = process.argv[2];
const expected = process.argv[3] ?? 'https://exavyn.vercel.app/update-password';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email) {
  console.error('Usage: npm run check:auth-redirect -- <disposable-test-email> [expected-redirect]');
  process.exit(2);
}
if (!url || !serviceKey) {
  console.error('BLOCKED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

function targetOf(actionLink) {
  try {
    return new URL(actionLink).searchParams.get('redirect_to') ?? '(none)';
  } catch {
    return '(unparseable)';
  }
}

const fallback = await service.auth.admin.generateLink({ type: 'recovery', email });
if (fallback.error) {
  console.error(`BLOCKED: could not generate a recovery link: ${fallback.error.message}`);
  process.exit(2);
}

const requested = await service.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo: expected },
});
if (requested.error) {
  console.error(`BLOCKED: could not generate a recovery link: ${requested.error.message}`);
  process.exit(2);
}

const actualFallback = targetOf(fallback.data.properties.action_link);
const actualRequested = targetOf(requested.data.properties.action_link);
console.log('Auth default redirect :', actualFallback);
console.log('Requested redirect   :', expected);
console.log('Returned redirect    :', actualRequested);

if (actualRequested !== expected) {
  console.error(
    '\nFAIL: the requested recovery redirect was not honored. Add it to Supabase Authentication → URL Configuration → Redirect URLs, and set Site URL to the canonical origin.',
  );
  process.exit(1);
}
console.log('\nPASS: hosted Auth honors the configured recovery redirect.');
