import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, Platform, Pressable, Text, View } from 'react-native';

import { saveRounds } from '@/data/repository';
import { emptyHoles, nowIso, TEE_BOXES, todayLocalDate, type Round, type TeeBox } from '@/domain/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { getCourseDetail, prefetchCourse } from '@/features/courses/courseDetail';
import { nearestCourses, searchCourses, type CourseSummary } from '@/features/courses/courseIndex';
import { getCurrentPositionOnce } from '@/features/gps/useDeviceLocation';
import { newId } from '@/lib/id';
import { Button, Card, Field, Label, Screen, Segmented } from '@/ui/components';
import { radius, spacing, useColors } from '@/ui/theme';

export default function NewRoundScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { userId } = useAuth();

  const [query, setQuery] = useState('');
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [nearby, setNearby] = useState<CourseSummary[]>([]);
  const [date, setDate] = useState(todayLocalDate());
  const [tee, setTee] = useState<TeeBox | null>(null);
  const [holesCount, setHolesCount] = useState<9 | 18>(18);
  const [companions, setCompanions] = useState('');
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => (course ? [] : searchCourses(query, 8)), [query, course]);
  const suggestions = query ? results : nearby;

  const findNearby = async () => {
    // Matched against the bundled course list on the device — the position is not sent anywhere.
    try {
      const me = await getCurrentPositionOnce();
      if (!me) return; // permission denied
      const found = nearestCourses(me, 5);
      if (!found.length) Alert.alert(t('round.noNearby'));
      setNearby(found);
    } catch {
      Alert.alert(t('round.locationUnavailable')); // no GPS fix yet (indoors, airplane mode, simulator)
    }
  };

  const create = async () => {
    const courseName = course?.name ?? query.trim();
    if (!courseName || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSaving(true);
    try {
      const id = newId();
      const at = nowIso();
      const detail = course ? await getCourseDetail(course.id).catch(() => null) : null;
      const pars = detail?.holes.length ? detail.holes.map((h) => h.par) : undefined;
      const round: Round = {
        id,
        user_id: userId,
        course_id: course?.id ?? null,
        course_name: courseName,
        tee_box: tee,
        companions: companions.trim(),
        played_on: date,
        holes_count: holesCount,
        entry_mode: 'stroke',
        exclude_from_stats: false,
        notes: '',
        source: 'manual',
        created_at: at,
        updated_at: at,
        deleted_at: null,
      };
      await saveRounds([{ round, holes: emptyHoles(id, userId, holesCount, pars, at) }]);
      if (course) void prefetchCourse(course.id);
      router.replace(`/round/${id}/score`);
    } catch (err) {
      Alert.alert(t('common.error'), (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Card>
        {course ? (
          // Selected course replaces the input: a focused TextInput would receive the IME's late
          // composition commit (Korean/Japanese keyboards) and clear the selection.
          <View style={{ gap: spacing.xs }}>
            <Label muted>{t('round.course')}</Label>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceAlt }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '600' }}>{course.name}</Text>
                <Text style={{ color: c.textMuted }}>
                  {course.city}, {course.state}
                </Text>
              </View>
              <Pressable onPress={() => setCourse(null)} hitSlop={8}>
                <Text style={{ color: c.primary, fontWeight: '600' }}>{t('round.changeCourse')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Field
            label={t('round.course')}
            placeholder={t('round.coursePlaceholder')}
            value={query}
            onChangeText={setQuery}
          />
        )}
        {Platform.OS !== 'web' && !query && !course && (
          <Button title={t('round.findNearby')} variant="secondary" onPress={() => void findNearby()} />
        )}
        {!course &&
          suggestions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                Keyboard.dismiss();
                setCourse(s);
              }}
              style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceAlt }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{s.name}</Text>
              <Text style={{ color: c.textMuted }}>
                {s.city}, {s.state}
              </Text>
            </Pressable>
          ))}
      </Card>

      <Card>
        <Field label={t('round.date')} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
        <Label muted>{t('round.holes')}</Label>
        <Segmented
          options={[
            { value: 18 as const, label: '18' },
            { value: 9 as const, label: '9' },
          ]}
          value={holesCount}
          onChange={setHolesCount}
        />
        <Label muted>{t('round.tee')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TEE_BOXES.map((tb) => (
            <Pressable
              key={tb}
              accessibilityLabel={tb}
              onPress={() => setTee(tee === tb ? null : tb)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: TEE_SWATCH[tb],
                borderWidth: tee === tb ? 3 : 1,
                borderColor: tee === tb ? c.primary : c.border,
              }}
            />
          ))}
        </View>
        <Field label={t('round.companions')} value={companions} onChangeText={setCompanions} />
      </Card>

      <Button title={t('round.create')} loading={saving} disabled={!(course || query.trim())} onPress={() => void create()} />
    </Screen>
  );
}

const TEE_SWATCH: Record<TeeBox, string> = {
  black: '#111827',
  blue: '#2563EB',
  white: '#F9FAFB',
  gold: '#CA8A04',
  silver: '#B8BBC2',
  red: '#DC2626',
  green: '#15803D',
};
