// Web social sign-in: Supabase OAuth redirect flow. Same exports as socialSignIn.ts.
import { getSupabase } from '@/lib/supabase';

// Off until the Apple provider (Services ID + key) is configured in Supabase; web OAuth fails without it.
// Guideline 4.8 only concerns the iOS app, which shows Apple via socialSignIn.ts.
export const appleSignInAvailable = false;
// Web uses Supabase's OAuth redirect; availability depends only on the Supabase provider setup.
export const googleSignInAvailable = true;

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
