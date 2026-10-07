import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { appleSignInAvailable, signInWithApple, signInWithGoogle } from '@/features/auth/socialSignIn';
import { isBackendConfigured } from '@/lib/env';
import { Button, Card, Field, Label, Screen, Title } from '@/ui/components';
import { spacing, useColors } from '@/ui/theme';

export default function SignInScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { signInWithEmail, signUpWithEmail, continueAsGuest } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      Alert.alert(t('common.error'), (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = () =>
    run('email', async () => {
      if (mode === 'signIn') return signInWithEmail(email.trim(), password);
      const { needsConfirmation } = await signUpWithEmail(email.trim(), password);
      if (needsConfirmation) Alert.alert(t('auth.checkEmail'));
    });

  const isWeb = Platform.OS === 'web';

  return (
    <Screen style={{ justifyContent: 'center', paddingVertical: spacing.xxl }}>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <Title>{t('auth.title')}</Title>
        <Label muted>{isWeb ? t('auth.webRequiresAccount') : t('auth.subtitle')}</Label>
      </View>

      {isBackendConfigured ? (
        <Card>
          {appleSignInAvailable && (
            <Button title={t('auth.apple')} variant="secondary" loading={busy === 'apple'} onPress={() => run('apple', signInWithApple)} />
          )}
          <Button title={t('auth.google')} variant="secondary" loading={busy === 'google'} onPress={() => run('google', signInWithGoogle)} />

          <Text style={{ color: c.textMuted, textAlign: 'center', marginVertical: spacing.sm }}>{t('auth.or')}</Text>

          <Field
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Field
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
          />
          <Button
            title={mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
            loading={busy === 'email'}
            disabled={!email || password.length < 8}
            onPress={submitEmail}
          />
          <Pressable onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')} style={{ padding: spacing.sm }}>
            <Text style={{ color: c.primary, textAlign: 'center' }}>
              {mode === 'signIn' ? t('auth.noAccount') : t('auth.haveAccount')}
            </Text>
          </Pressable>
        </Card>
      ) : (
        <Label muted>{t('auth.backendMissing')}</Label>
      )}

      {/* App Store 5.1.1: features that don't need an account must work without one. */}
      {!isWeb && (
        <View style={{ gap: spacing.xs, marginTop: spacing.lg }}>
          <Button title={t('auth.continueAsGuest')} variant="secondary" onPress={continueAsGuest} />
          <Label muted>{t('auth.guestNote')}</Label>
        </View>
      )}
    </Screen>
  );
}
