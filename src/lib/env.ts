// Public (client-bundled) configuration. Never put secrets here: EXPO_PUBLIC_* values ship inside the app.

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
};

/** False until .env is filled in; the app then runs in guest/local-only mode. */
export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
