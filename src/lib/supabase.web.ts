// Web Supabase client. Uses the browser's localStorage and reads OAuth redirects from the URL.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env, isBackendConfigured } from './env';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isBackendConfigured) throw new Error('Supabase is not configured. Copy .env.example to .env.');
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        persistSession: typeof window !== 'undefined', // no storage during static rendering
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
