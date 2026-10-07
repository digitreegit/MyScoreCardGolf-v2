// In-app account deletion (App Store guideline 5.1.1(v)).
// Deleting the auth user cascades to profiles, rounds, round_holes and scan_usage.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders, json, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await userClient(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { error } = await admin.auth.admin.deleteUser(caller.userId);
  if (error) return json({ error: 'delete_failed' }, 500);
  return json({ ok: true });
});
