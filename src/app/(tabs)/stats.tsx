import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { useRounds } from '@/data/hooks';
import { computeStats, type ScoreName } from '@/domain/stats';
import { Card, Label, Loading, Screen, Stat } from '@/ui/components';
import { radius, spacing, useColors } from '@/ui/theme';

const DIST_ORDER: ScoreName[] = ['eagleOrBetter', 'birdie', 'par', 'bogey', 'double', 'tripleOrWorse'];

const fmt = (n: number | null, digits = 1) => (n == null ? '–' : n.toFixed(digits).replace(/\.0+$/, ''));
const fmtToPar = (n: number | null) => (n == null ? '–' : n > 0 ? `+${fmt(n)}` : fmt(n));

export default function StatsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { data, loading } = useRounds();
  const s = useMemo(() => computeStats(data), [data]);

  if (loading) return <Loading />;
  if (s.rounds === 0) {
    return (
      <Screen>
        <Label muted>{t('stats.notEnough')}</Label>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <Stat label={t('stats.rounds')} value={String(s.rounds)} />
        <Stat label={t('stats.avg')} value={fmt(s.scoringAvg18)} />
        <Stat label={t('stats.best')} value={fmt(s.best18, 0)} />
        <Stat label={t('stats.toPar')} value={fmtToPar(s.avgToPar18)} />
        <Stat label={t('stats.putts')} value={fmt(s.avgPutts18)} />
        <Stat label={t('stats.fir')} value={s.firPct == null ? '–' : `${s.firPct}%`} />
      </Card>

      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <Stat label={t('stats.par3')} value={fmt(s.parTypeAvg[3], 2)} />
        <Stat label={t('stats.par4')} value={fmt(s.parTypeAvg[4], 2)} />
        <Stat label={t('stats.par5')} value={fmt(s.parTypeAvg[5], 2)} />
      </Card>

      <Card>
        <Label>{t('stats.distribution')}</Label>
        {DIST_ORDER.map((k) => {
          const pct = Math.round(s.distribution[k] * 1000) / 10;
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ width: 72, color: c.text }}>{t(`stats.${k}`)}</Text>
              <View style={{ flex: 1, height: 14, backgroundColor: c.surfaceAlt, borderRadius: radius.sm, overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: c.primary }} />
              </View>
              <Text style={{ width: 52, textAlign: 'right', color: c.textMuted, fontVariant: ['tabular-nums'] }}>{pct}%</Text>
            </View>
          );
        })}
      </Card>
      <Label muted>{t('stats.note')}</Label>
    </Screen>
  );
}
