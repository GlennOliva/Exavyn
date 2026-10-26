// One-time initial administrator provisioning.
//
// Deploy:
//   supabase functions deploy bootstrap-admin --no-verify-jwt
//   supabase secrets set BOOTSTRAP_ADMIN_TOKEN=<long-random-string>
//
// Invoke ONCE with the token, then rotate/remove the secret.
// This function is the ONLY path that grants the very first admin role; every
// later admin is created by an existing administrator.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('EXAVYN_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expectedToken = Deno.env.get('BOOTSTRAP_ADMIN_TOKEN');

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server is not configured' }, 500);
  }
  if (!expectedToken) {
    return json({ error: 'BOOTSTRAP_ADMIN_TOKEN is not configured' }, 500);
  }

  let body: { token?: string; email?: string; password?: string; full_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Constant-time-ish comparison to reduce timing signal.
  const provided = body.token ?? '';
  if (provided.length !== expectedToken.length || provided !== expectedToken) {
    return json({ error: 'Invalid bootstrap token' }, 403);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || password.length < 8) {
    return json({ error: 'A valid email and an 8+ character password are required' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Reuse the account if it already exists.
  const { data: existing } = await admin.auth.admin.listUsers();
  const already = existing?.users.find((u) => u.email?.toLowerCase() === email);

  let userId = already?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name ?? 'Administrator' },
    });
    if (error || !data.user) {
      return json({ error: error?.message ?? 'Could not create user' }, 400);
    }
    userId = data.user.id;
  }

  // The signup trigger created a student role; promote to admin (service role).
  const { error: roleError } = await admin
    .from('user_roles')
    .upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id' });
  if (roleError) {
    return json({ error: roleError.message }, 400);
  }

  await admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'bootstrap.admin_created',
    entity_type: 'profile',
    entity_id: userId,
  });

  return json({ ok: true, user_id: userId, created: !already });
});
