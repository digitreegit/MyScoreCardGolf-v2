import '@/i18n';

import * as ScreenOrientation from 'expo-screen-orientation';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, useColorScheme } from 'react-native';

import { importV1DataOnce } from '@/data/v1Import';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { setLanguage } from '@/i18n';
import { prefs, PREF_KEYS } from '@/lib/prefs';

SplashScreen.preventAutoHideAsync();

if (Platform.OS !== 'web') {
  // Portrait everywhere except the score card, which locks itself to landscape.
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const { ready, canEnterApp, userId } = useAuth();
  const v1Checked = useRef(false);

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    if (v1Checked.current) return;
    v1Checked.current = true;
    void importV1DataOnce(userId).then((res) => {
      if (!res) return;
      if (res.language && !prefs.get(PREF_KEYS.language)) setLanguage(res.language);
      if (res.imported > 0) Alert.alert(t('v1.imported', { count: res.imported }));
    });
  }, [ready, userId, t]);

  if (!ready) return null;

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={canEnterApp}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="round/new" options={{ title: t('round.newTitle'), presentation: 'modal' }} />
          <Stack.Screen name="round/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="round/[id]/score" options={{ headerShown: false }} />
          <Stack.Screen name="scan" options={{ title: t('scan.title') }} />
          <Stack.Screen name="import-export" options={{ title: t('io.title') }} />
        </Stack.Protected>
        <Stack.Protected guard={!canEnterApp}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
