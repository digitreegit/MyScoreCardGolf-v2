// Web social sign-in: Supabase OAuth redirect flow. Same exports as socialSignIn.ts.
import { getSupabase } from '@/lib/supabase';

export const appleSignInAvailable = true;

async function oauth(provider: 'google' | 'apple'): Promise<boolean> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return true; // the page navigates away; the session is picked up from the URL on return
}

export const signInWithGoogle = () => oauth('google');
export const signInWithApple = () => oauth('apple');
export async function signOutSocial(): Promise<void> {}
