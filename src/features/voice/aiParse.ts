// Optional AI fallback for voice entry (Settings → AI voice assist, off by default).
// Sends only the transcript text and the hole/par table — never audio or location.
import { sanitizeAiResult, type AiVoicePatch } from '@/domain/voice/aiResult';
import { prefs, PREF_KEYS } from '@/lib/prefs';
import { getSupabase } from '@/lib/supabase';

export function isVoiceAiEnabled(): boolean {
  return prefs.get(PREF_KEYS.voiceAiAssist) === '1';
}

export function setVoiceAiEnabled(on: boolean): void {
  prefs.set(PREF_KEYS.voiceAiAssist, on ? '1' : null);
}

export async function parseVoiceWithAI(
  transcript: string,
  holes: Array<{ hole_number: number; par: number }>,
  currentHole: number,
): Promise<AiVoicePatch | null> {
  const { data, error } = await getSupabase().functions.invoke<{ result: unknown }>('parse-voice', {
    body: { transcript, holes, currentHole },
  });
  if (error || !data) return null; // offline, quota reached, or server error: treat as not understood
  return sanitizeAiResult(data.result, holes.length);
}
