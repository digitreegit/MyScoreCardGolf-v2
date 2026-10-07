import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { saveRounds } from '@/data/repository';
import { scanToRound, type ScanResult } from '@/domain/scanResult';
import { nowIso } from '@/domain/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { pickScorecardImage, scanScorecard } from '@/features/scan/scanScorecard';
import { newId } from '@/lib/id';
import { Button, Card, Label, Screen } from '@/ui/components';
import { radius, spacing, useColors } from '@/ui/theme';

export default function ScanScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { userId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  if (!userId) {
    return (
      <Screen>
        <Label muted>{t('scan.signInRequired')}</Label>
      </Screen>
    );
  }

  const run = async (source: 'camera' | 'library') => {
    const picked = await pickScorecardImage(source);
    if (typeof picked === 'string') return; // cancelled / no permission
    setBusy(true);
    setResult(null);
    try {
      const res = await scanScorecard(picked);
      if ('error' in res) {
        Alert.alert(res.error === 'quota_exceeded' ? t('scan.quotaExceeded') : t('scan.failed'));
        return;
      }
      if (!res.result.players.length) {
        Alert.alert(t('scan.failed'));
        return;
      }
      setResult(res.result);
      setRemaining(res.remaining);
    } catch {
      Alert.alert(t('scan.failed'));
    } finally {
      setBusy(false);
    }
  };

  // The scanned round opens in the score card so every hole can be checked before relying on it.
  const pick = async (index: number) => {
    if (!result) return;
    const item = scanToRound(result, index, { userId, newId, now: nowIso() });
    await saveRounds([item]);
    router.replace(`/round/${item.round.id}/score`);
  };

  return (
    <Screen>
      <Card>
        <Button title={t('scan.takePhoto')} loading={busy} onPress={() => void run('camera')} />
        <Button title={t('scan.choosePhoto')} variant="secondary" disabled={busy} onPress={() => void run('library')} />
        {busy && <Label muted>{t('scan.scanning')}</Label>}
        {remaining != null && <Label muted>{t('scan.remaining', { count: remaining })}</Label>}
      </Card>

      {result && (
        <Card>
          <Label>{t('scan.pickPlayer')}</Label>
          {result.confidence === 'low' && <Label muted>{t('scan.lowConfidence')}</Label>}
          {result.players.map((p, i) => (
            <Pressable
              key={i}
              onPress={() => void pick(i)}
              style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceAlt, gap: 2 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{p.name || t('scan.player', { n: i + 1 })}</Text>
              <View>
                <Text style={{ color: c.textMuted, fontVariant: ['tabular-nums'] }}>
                  {p.scores.map((s) => (s == null ? '·' : s)).join(' ')}
                </Text>
              </View>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
