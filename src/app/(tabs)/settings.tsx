import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Switch } from 'react-native';

import { countUnsynced } from '@/data/accountData';
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus } from '@/data/sync/syncEngine';
import type { DistanceUnit } from '@/domain/geo';
import { useAuth } from '@/features/auth/AuthProvider';
import { isVoiceAiEnabled, setVoiceAiEnabled } from '@/features/voice/aiParse';
import { LANGUAGES, setLanguage } from '@/i18n';
import { prefs, PREF_KEYS } from '@/lib/prefs';
import { Button, Card, Label, Screen, Segmented } from '@/ui/components';

function confirm(title: string, message: string, destructiveLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: destructiveLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { session, isGuest, showSignIn, signOut, deleteAccount } = useAuth();
  const [unit, setUnit] = useState<DistanceUnit>(() => (prefs.get(PREF_KEYS.distanceUnit) as DistanceUnit) ?? 'yards');
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  const [unsynced, setUnsynced] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSyncStatus(setSync), []);
  useEffect(() => {
    void countUnsynced().then(setUnsynced);
  }, [sync]);

  const [voiceAi, setVoiceAi] = useState(isVoiceAiEnabled);
  const toggleVoiceAi = (on: boolean) => {
    setVoiceAiEnabled(on);
    setVoiceAi(on);
  };

  const changeUnit = (u: DistanceUnit) => {
    prefs.set(PREF_KEYS.distanceUnit, u);
    setUnit(u);
  };

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert(t('common.error'), (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Label>{t('settings.language')}</Label>
        <Segmented
          options={LANGUAGES.map((l) => ({ value: l.code as string, label: l.label }))}
          value={i18n.language}
          onChange={setLanguage}
        />
        <Label>{t('settings.distanceUnit')}</Label>
        <Segmented
          options={[
            { value: 'yards' as DistanceUnit, label: t('settings.yards') },
            { value: 'meters' as DistanceUnit, label: t('settings.meters') },
          ]}
          value={unit}
          onChange={changeUnit}
        />
        {Platform.OS !== 'web' && (
          <>
            {/* The whole row toggles; a bare Switch is a small target on a golf course. */}
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: voiceAi && !!session, disabled: !session }}
              disabled={!session}
              onPress={() => toggleVoiceAi(!voiceAi)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <Label>{t('settings.voiceAi')}</Label>
              <Switch value={voiceAi && !!session} disabled={!session} onValueChange={toggleVoiceAi} />
            </Pressable>
            <Label muted>{session ? t('settings.voiceAiNote') : t('settings.voiceAiSignIn')}</Label>
          </>
        )}
      </Card>

      <Card>
        <Button title={t('settings.importExport')} variant="secondary" onPress={() => router.push('/import-export')} />
        {Platform.OS !== 'web' && (
          <Button title={t('settings.scan')} variant="secondary" onPress={() => router.push('/scan')} />
        )}
      </Card>

      <Card>
        <Label>{t('settings.account')}</Label>
        {isGuest ? (
          <>
            <Label muted>{t('settings.guest')}</Label>
            <Button title={t('settings.signIn')} onPress={showSignIn} />
          </>
        ) : (
          <>
            <Label muted>{session?.user.email ?? ''}</Label>
            {Platform.OS !== 'web' && (
              <>
                <Label muted>
                  {sync.state === 'offline'
                    ? t('settings.syncOffline')
                    : sync.state === 'error' && sync.retryAt
                      ? t('settings.syncRetrying', { time: new Date(sync.retryAt).toLocaleTimeString() })
                      : sync.lastSyncedAt
                      ? t('settings.lastSynced', { time: new Date(sync.lastSyncedAt).toLocaleTimeString() })
                      : ''}
                  {unsynced > 0 ? ` · ${unsynced} ${t('rounds.unsynced')}` : ''}
                </Label>
                <Button title={t('settings.syncNow')} variant="secondary" loading={sync.state === 'syncing'} onPress={() => void syncNow()} />
              </>
            )}
            <Button
              title={t('settings.signOut')}
              variant="secondary"
              loading={busy}
              onPress={() => confirm(t('settings.signOut'), t('settings.signOutConfirm'), t('settings.signOut'), () => void guarded(signOut))}
            />
            <Button
              title={t('settings.deleteAccount')}
              variant="danger"
              disabled={busy}
              onPress={() =>
                confirm(t('settings.deleteAccount'), t('settings.deleteAccountConfirm'), t('common.delete'), () => void guarded(deleteAccount))
              }
            />
          </>
        )}
      </Card>
      <Label muted>Course data © OpenStreetMap contributors (ODbL)</Label>
    </Screen>
  );
}
