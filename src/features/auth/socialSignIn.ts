// Native social sign-in: get an ID token from the OS / Google SDK, then exchange it with Supabase.
// Supabase dashboard setup is described in README.md ("Auth providers").

import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

let googleConfigured = false;

/** Apple sign-in is offered on iOS only (App Store guideline 4.8 applies to the iOS app). */
export const appleSignInAvailable = Platform.OS === 'ios';

/** Returns false when the user cancelled. */
export async function signInWithGoogle(): Promise<boolean> {
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: env.googleWebClientId, iosClientId: env.googleIosClientId || undefined });
    googleConfigured = true;
  }
  try {
    await GoogleSignin.hasPlayServices();
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return false;
    const token = res.data.idToken;
    if (!token) throw new Error('Google did not return an ID token');
    const { error } = await getSupabase().auth.signInWithIdToken({ provider: 'google', token });
    if (error) throw error;
    return true;
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.IN_PROGRESS) return false;
    throw err;
  }
}

export async function signInWithApple(): Promise<boolean> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple did not return an identity token');
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
    if (error) throw error;
    // Apple sends the name only on the very first sign-in, so store it right away.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    if (name) await supabase.auth.updateUser({ data: { full_name: name } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
    throw err;
  }
}

export async function signOutSocial(): Promise<void> {
  if (googleConfigured) await GoogleSignin.signOut().catch(() => undefined);
}
