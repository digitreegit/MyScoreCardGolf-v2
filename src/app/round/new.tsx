// New round. On the phone, the course you're standing at is recognized automatically from the
// bundled course list (on-device; the position is never sent). One match is picked for you,
// several (e.g. a 36-hole club) are listed to choose from. Pars are filled in from your own
// last round there, else map data — see features/courses/coursePars.

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, Platform, Pressable, Text, View } from 'react-native';

import { saveRounds } from '@/data/repository';
import { emptyHoles, nowIso, TEE_BOXES, todayLocalDate, type Round, type TeeBox } from '@/domain/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { prefetchCourse } from '@/features/courses/courseDetail';
import { coursesHere, courseLocation, searchCourses, type CourseSummary } from '@/features/courses/courseIndex';
import { parsForCourse, type ParSource } from '@/features/courses/coursePars';
import { getCurrentPositionOnce } from '@/features/location/currentPosition';
import { newId } from '@/lib/id';
import { getScoreMode } from '@/lib/scoreMode';
import { Button, Card, Field, Label, Screen, Segmented } from '@/ui/components';
import { radius, spacing, useColors } from '@/ui/theme';

export default function NewRoundScreen() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { userId } = useAuth();

  const [query, setQuery] = useState('');
  const [course, setCourse] = useState<(CourseSummary & { meters?: number }) | null>(null);
  const [nearby, setNearby] = useState<Array<CourseSummary & { meters: number }>>([]);
  const [locate, setLocate] = useState<'idle' | 'locating' | 'here' | 'near' | 'none' | 'failed'>(
    Platform.OS === 'web' ? 'idle' : 'locating',
  );
  const [parInfo, setParInfo] = useState<{ courseId: string; holes: number; pars: number[]; source: ParSource } | null>(null);
  const [date, setDate] = useState(todayLocalDate());
  const [tee, setTee] = useState<TeeBox | null>(null);
  const [holesCount, setHolesCount] = useState<9 | 18>(18);
  const [companions, setCompanions] = useState('');
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => (course ? [] : searchCourses(query, 8)), [query, course]);
  const suggestions: Array<CourseSummary & { meters?: number }> = query ? results : nearby;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    getCurrentPositionOnce()
      .then((me) => {
        if (cancelled) return;
        if (!me) return setLocate('idle'); // permission denied: search by name
        const found = coursesHere(me);
        setNearby(found.courses);
        setLocate(found.here ? 'here' : found.courses.length ? 'near' : 'none');
        // Exactly one course here: pick it. Several (36-hole clubs, neighbors): let the player choose.
        if (found.here && found.courses.length === 1) setCourse((cur) => cur ?? found.courses[0]);
      })
      .catch(() => !cancelled && setLocate('failed')); // no fix yet (indoors, airplane mode)
    return () => {
      cancelled = true;
    };
  }, []);

  // Look up pars as soon as a course is picked, so "Start round" doesn't wait on the network.
  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    void prefetchCourse(course.id);
    void parsForCourse(course, holesCount).then((r) => {
      if (!cancelled) setParInfo({ courseId: course.id, holes: holesCount, ...r });
    });
    return () => {
      cancelled = true;
    };
  }, [course, holesCount]);
  const pars = parInfo && course && parInfo.courseId === course.id && parInfo.holes === holesCount ? parInfo : null;

  const distance = (meters: number) =>
    i18n.language.startsWith('ko') ? `${(meters / 1000).toFixed(1)} km` : `${(meters / 1609.344).toFixed(1)} mi`;

  const create = async () => {
    const courseName = course?.name ?? query.trim();
    if (!courseName || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSaving(true);
    try {
      const id = newId();
      const at = nowIso();
      const holePars = (pars ?? (await parsForCourse({ id: course?.id ?? null, name: courseName }, holesCount))).pars;
      const round: Round = {
        id,
        user_id: userId,
        course_id: course?.id ?? null,
        course_name: courseName,
        tee_box: tee,
        companions: companions.trim(),
        played_on: date,
        holes_count: holesCount,
        entry_mode: getScoreMode(),
        exclude_from_stats: false,
        notes: '',
        source: 'manual',
        created_at: at,
        updated_at: at,
        deleted_at: null,
      };
      await saveRounds([{ round, holes: emptyHoles(id, userId, holesCount, holePars, at) }]);
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
                  {[courseLocation(course), course.meters != null ? distance(course.meters) : null].filter(Boolean).join(' · ')}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                  {pars ? t(`round.pars.${pars.source}`, { total: pars.pars.reduce((a, b) => a + b, 0) }) : t('round.pars.loading')}
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
        {!query && !course && locate !== 'idle' && (
          <Label muted>{t(`round.locate.${locate}`)}</Label>
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
                {[courseLocation(s), s.meters != null ? distance(s.meters) : null].filter(Boolean).join(' · ')}
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
