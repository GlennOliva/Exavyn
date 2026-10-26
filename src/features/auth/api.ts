import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type { AppRole, ProfileRow } from '../../lib/database.types';
import { passwordResetRedirectUrl } from './recovery';

export interface SessionUser {
  id: string;
  email: string | null;
  profile: ProfileRow;
  role: AppRole;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw toAppError(error);
}

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ session: Session | null }> {
  // Role is never supplied here; the database trigger always creates a student.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw toAppError(error);
  // Email confirmation is disabled, so a successful signup returns a live
  // session. A null session means no new account was created (for example,
  // the address is already registered); the caller handles that case.
  return { session: data.session };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAppError(error);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: passwordResetRedirectUrl(window.location.origin),
  });
  if (error) throw toAppError(error);
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw toAppError(error);
}

export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw toAppError(profileError);
  if (!profile) return null;

  const { data: roleRow, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (roleError) throw toAppError(roleError);

  return {
    id: userId,
    email: profile.email,
    profile,
    role: (roleRow?.role as AppRole | undefined) ?? 'student',
  };
}
