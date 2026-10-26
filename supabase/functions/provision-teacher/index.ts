// Admin-only teacher provisioning. The caller must present a valid admin JWT.
//
// Deploy: supabase functions deploy provision-teacher
// (JWT verification stays ON; the caller's Authorization header is required.)
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
  const anonKey = Deno.env.get('EXAVYN_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('EXAVYN_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Missing bearer token' }, 401);
  }

  // Verify the caller is an administrator using their own token + RLS.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roleRow, error: roleErr } = await caller
    .from('user_roles')
    .select('role')
    .eq('user_id', (await caller.auth.getUser()).data.user?.id ?? '')
    .maybeSingle();

  if (roleErr || roleRow?.role !== 'admin') {
    return json({ error: 'Administrator privileges required' }, 403);
  }

  let body: { email?: string; password?: string; full_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || password.length < 8) {
    return json({ error: 'A valid email and an 8+ character password are required' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name ?? 'Teacher' },
  });
  if (error || !created.user) {
    return json({ error: error?.message ?? 'Could not create user' }, 400);
  }

  const { error: roleError } = await admin
    .from('user_roles')
    .upsert({ user_id: created.user.id, role: 'teacher' }, { onConflict: 'user_id' });
  if (roleError) {
    return json({ error: roleError.message }, 400);
  }

  return json({ ok: true, user_id: created.user.id });
});
