import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Switch, View } from 'react-native';

import { useRound } from '@/data/hooks';
import { deleteRound, updateRound } from '@/data/repository';
import { roundTotals } from '@/domain/stats';
import { Button, Card, Field, Label, Loading, Screen, Stat } from '@/ui/components';
import { spacing } from '@/ui/theme';

export default function RoundDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useRound(id);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (data) setNotes(data.round.notes);
  }, [data?.round.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (!data || data.round.deleted_at) return <Screen><Label muted>{t('common.error')}</Label></Screen>;

  const { round, holes } = data;
  const totals = roundTotals(holes);

  const remove = () => {
    const go = async () => {
      await deleteRound(round);
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('round.deleteConfirm'))) void go();
      return;
    }
    Alert.alert(t('round.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void go() },
    ]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: round.course_name }} />
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <Stat label={round.played_on} value={totals.holesPlayed ? String(totals.strokes) : '–'} />
        <Stat label={t('round.toPar')} value={totals.holesPlayed ? (totals.toPar > 0 ? `+${totals.toPar}` : String(totals.toPar)) : '–'} />
        <Stat label={t('round.putts')} value={totals.putts == null ? '–' : String(totals.putts)} />
      </Card>

      <Button title={t('round.enterScores')} onPress={() => router.push(`/round/${round.id}/score`)} />
      {round.course_id && Platform.OS !== 'web' && (
        <Button title={t('round.gps')} variant="secondary" onPress={() => router.push(`/round/${round.id}/gps`)} />
      )}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{t('round.excludeFromStats')}</Label>
          <Switch
            value={round.exclude_from_stats}
            onValueChange={(v) => void updateRound(round, { exclude_from_stats: v })}
          />
        </View>
        <Field
          label={t('round.notes')}
          value={notes}
          onChangeText={setNotes}
          onBlur={() => notes !== round.notes && void updateRound(round, { notes })}
          multiline
          style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: spacing.sm }}
        />
      </Card>

      <Button title={t('common.delete')} variant="danger" onPress={remove} />
    </Screen>
  );
}
