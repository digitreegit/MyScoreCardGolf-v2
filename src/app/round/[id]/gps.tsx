import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useRound } from '@/data/hooks';
import { greenDistances, type DistanceUnit } from '@/domain/geo';
import { getCourseDetail, type CourseDetail } from '@/features/courses/courseDetail';
import { useDeviceLocation } from '@/features/gps/useDeviceLocation';
import { prefs, PREF_KEYS } from '@/lib/prefs';
import { Button, Label, Loading, Screen } from '@/ui/components';
import { spacing, useColors } from '@/ui/theme';

export default function GpsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useRound(id);
  const [course, setCourse] = useState<CourseDetail | null | undefined>(undefined);
  const [holeNo, setHoleNo] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const unit = (prefs.get(PREF_KEYS.distanceUnit) as DistanceUnit) ?? 'yards';

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const loc = useDeviceLocation(focused);

  const courseId = data?.round.course_id;
  useEffect(() => {
    if (!courseId) return;
    getCourseDetail(courseId).then(setCourse, () => setCourse(null));
  }, [courseId]);

  // Start on the first hole without a score.
  useEffect(() => {
    if (holeNo != null || !data) return;
    setHoleNo(data.holes.find((h) => h.strokes == null)?.hole_number ?? 1);
  }, [data, holeNo]);

  if (!data || course === undefined || holeNo == null) return <Loading />;

  const hole = course?.holes.find((h) => h.hole_number === holeNo);
  const d = hole && loc.position ? greenDistances(loc.position, hole.green, unit) : null;
  const unitLabel = unit === 'yards' ? 'yd' : 'm';

  return (
    <Screen>
      <Text style={[styles.hole, { color: c.text }]}>
        {t('gps.title', { hole: holeNo })}
        {hole ? `  ·  Par ${hole.par}` : ''}
      </Text>

      {!hole ? (
        <Label muted>{t('gps.noCourseData')}</Label>
      ) : loc.permission === 'denied' ? (
        <Label muted>{t('gps.permissionDenied')}</Label>
      ) : (
        <View style={styles.distances}>
          <Text style={[styles.side, { color: c.textMuted }]}>
            {t('gps.back')} {d?.back ?? '–'}
          </Text>
          <Text style={[styles.center, { color: c.text }]}>
            {d?.center ?? '–'}
            <Text style={{ fontSize: 24 }}> {unitLabel}</Text>
          </Text>
          <Text style={[styles.side, { color: c.textMuted }]}>
            {t('gps.front')} {d?.front ?? '–'}
          </Text>
          {loc.accuracyMeters != null && (
            <Text style={{ color: c.textMuted }}>{t('gps.accuracy', { meters: Math.round(loc.accuracyMeters) })}</Text>
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button title={t('gps.prev')} variant="secondary" style={{ flex: 1 }} disabled={holeNo <= 1} onPress={() => setHoleNo(holeNo - 1)} />
        <Button
          title={t('gps.next')}
          variant="secondary"
          style={{ flex: 1 }}
          disabled={holeNo >= data.round.holes_count}
          onPress={() => setHoleNo(holeNo + 1)}
        />
      </View>
      <Label muted>{t('gps.privacyNote')}</Label>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hole: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  distances: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  center: { fontSize: 88, fontWeight: '800', fontVariant: ['tabular-nums'] },
  side: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
