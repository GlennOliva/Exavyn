import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { supabaseAnonKey, supabaseUrl } from './config';

/**
 * Browser-safe Supabase client. Only the publishable (anon) key is ever used
 * here. Row Level Security enforces every access decision. Service-role keys
 * must never reach this bundle.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
