import { Link, Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRounds } from '@/data/hooks';
import { roundTotals } from '@/domain/stats';
import type { RoundWithHoles } from '@/domain/types';
import { Loading } from '@/ui/components';
import { maxContentWidth, radius, spacing, useColors } from '@/ui/theme';

function formatToPar(n: number) {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : String(n);
}

function RoundRow({ item }: { item: RoundWithHoles }) {
  const c = useColors();
  const { round, holes } = item;
  const t = roundTotals(holes);
  return (
    <Link href={`/round/${round.id}`} asChild>
      <Pressable style={({ pressed }) => [styles.row, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.course, { color: c.text }]} numberOfLines={1}>
            {round.course_name}
          </Text>
          <Text style={{ color: c.textMuted }}>
            {round.played_on} · {round.holes_count}H{round.exclude_from_stats ? ' · ⦸' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.total, { color: c.text }]}>{t.holesPlayed ? t.strokes : '–'}</Text>
          {t.holesPlayed > 0 && <Text style={{ color: c.textMuted }}>{formatToPar(t.toPar)}</Text>}
        </View>
      </Pressable>
    </Link>
  );
}

export default function RoundsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { data, loading } = useRounds();

  if (loading) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: t('tabs.rounds') }} />
      <FlatList
        data={data}
        keyExtractor={(r) => r.round.id}
        renderItem={({ item }) => <RoundRow item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{t('rounds.empty')}</Text>
            <Text style={{ color: c.textMuted }}>{t('rounds.emptyHint')}</Text>
          </View>
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('rounds.add')}
        onPress={() => router.push('/round/new')}
        style={({ pressed }) => [styles.fab, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}>
        <Text style={{ color: c.primaryText, fontSize: 30, lineHeight: 32 }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  course: { fontSize: 17, fontWeight: '600' },
  total: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: 80 },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
