// Supabase Realtime subscription for the signed-in user's rounds (shared by native and web).
// Each platform decides what to do on a change: native pulls into SQLite, web reloads its views.

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

let channel: RealtimeChannel | null = null;

export function subscribeToRoundChanges(userId: string, onChange: () => void): void {
  unsubscribeFromRoundChanges();
  const supabase = getSupabase();
  const filter = `user_id=eq.${userId}`;
  channel = supabase
    .channel(`rounds:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'round_holes', filter }, onChange)
    .subscribe((status, err) => {
      if (__DEV__) console.log('[realtime]', status, err?.message ?? '');
    });
}

export function unsubscribeFromRoundChanges(): void {
  if (!channel) return;
  void getSupabase().removeChannel(channel);
  channel = null;
}
