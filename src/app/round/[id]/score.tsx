// Score entry in two layouts, switched with the rotate icon (choice is remembered per device):
//   portrait (default): 6-column hole tiles on top, number pad at the bottom
//   landscape: the full paper-style card with the pad on the right (18Birdies-style)
// Entering strokes jumps to that hole's putts; entering putts jumps to the next hole.
// Settings → Score mode decides whether the card reads in strokes (5) or over/under par (+1).
// The par of the selected hole can be corrected on the pad (map data and defaults can be wrong).

import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRound } from '@/data/hooks';
import { updateHole } from '@/data/repository';
import { displayScore, formatToPar, padStrokes, parChangePatch, toParRange } from '@/domain/scoring';
import { roundTotals, sumRange } from '@/domain/stats';
import type { EntryMode, RoundHole } from '@/domain/types';
import type { ParsedScore } from '@/domain/voice/parseScoreUtterance';
import { resolveStrokes } from '@/domain/voice/parseScoreUtterance';
import { useAuth } from '@/features/auth/AuthProvider';
import { isVoiceAiEnabled, parseVoiceWithAI } from '@/features/voice/aiParse';
import { useVoiceScore } from '@/features/voice/useVoiceScore';
import { prefs, PREF_KEYS } from '@/lib/prefs';
import { getScoreMode } from '@/lib/scoreMode';
import { Loading } from '@/ui/components';
import { radius, scoreColor, spacing, useColors, type Colors } from '@/ui/theme';

type Field = 'strokes' | 'putts';
type Layout = 'portrait' | 'landscape';

const lockFor = (layout: Layout) =>
  ScreenOrientation.lockAsync(
    layout === 'landscape' ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
  );
interface Selection {
  hole: number;
  field: Field;
}

export default function ScoreEntryScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useRound(id);
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const [sel, setSel] = useState<Selection>({ hole: 1, field: 'strokes' });
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>(() =>
    prefs.get(PREF_KEYS.scoreLayout) === 'landscape' ? 'landscape' : 'portrait',
  );
  const [mode] = useState<EntryMode>(getScoreMode);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Rotate only after the push/replace animation finishes: rotating mid-transition froze the
  // screen on iOS (seen when opening a scanned round). The timer covers entries with no transition.
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      let locked = false;
      const lock = () => {
        if (locked) return;
        locked = true;
        void lockFor(layoutRef.current);
      };
      const unsubscribe = navigation.addListener('transitionEnd' as never, lock);
      const fallback = setTimeout(lock, 700);
      return () => {
        unsubscribe();
        clearTimeout(fallback);
        void lockFor('portrait'); // the rest of the app is portrait
      };
    }, [navigation]),
  );

  const toggleLayout = () => {
    const next: Layout = layout === 'portrait' ? 'landscape' : 'portrait';
    prefs.set(PREF_KEYS.scoreLayout, next);
    setLayout(next);
    if (Platform.OS !== 'web') void lockFor(next); // no navigation transition here, rotate right away
  };

  // Taps update the card instantly; writes are queued behind (repository serializes them).
  const [pending, setPending] = useState<Record<string, number | null>>({});
  const pendingKey = (n: number, f: Field) => `${n}:${f}`;
  const holes = (data?.holes ?? []).map((h) => {
    const s = pending[pendingKey(h.hole_number, 'strokes')];
    const p = pending[pendingKey(h.hole_number, 'putts')];
    return s === undefined && p === undefined ? h : { ...h, ...(s !== undefined && { strokes: s }), ...(p !== undefined && { putts: p }) };
  });
  const holeAt = (n: number) => holes.find((h) => h.hole_number === n);

  const setValue = useCallback(
    (hole: RoundHole, field: Field, value: number | null) => {
      const key = pendingKey(hole.hole_number, field);
      setPending((prev) => ({ ...prev, [key]: value }));
      if (field === 'strokes') setSel({ hole: hole.hole_number, field: 'putts' });
      else if (hole.hole_number < holes.length) setSel({ hole: hole.hole_number + 1, field: 'strokes' });
      void updateHole(hole, { [field]: value }).finally(() =>
        setPending((prev) => {
          if (prev[key] !== value) return prev; // a newer tap on the same cell is still in flight
          const { [key]: _done, ...rest } = prev;
          return rest;
        }),
      );
    },
    [holes.length],
  );

  const { userId } = useAuth();

  const onVoice = useCallback(
    async (parsed: ParsedScore | null, transcript: string) => {
      if (__DEV__) console.log('[voice]', JSON.stringify(transcript), JSON.stringify(parsed));
      // 1) On-device rule parser (free, offline).
      let holeNumber = parsed?.hole ?? sel.hole;
      let target = holes.find((h) => h.hole_number === holeNumber);
      const patch: Partial<RoundHole> = {};
      if (parsed && target) {
        const strokes = resolveStrokes(parsed, target.par, mode);
        if (strokes != null) patch.strokes = strokes;
        if (parsed.putts != null) patch.putts = parsed.putts;
      }

      // 2) Optional AI fallback when the rule parser found no score or putts, or only got there by
      //    correcting likely mishearings ("play one part" → par). A guessed result is not applied
      //    if the AI can't confirm it.
      let viaAi = false;
      const aiOn = !!transcript && !!userId && isVoiceAiEnabled();
      if (aiOn && parsed?.guessed) {
        for (const k of Object.keys(patch) as Array<keyof RoundHole>) delete patch[k];
      }
      if (!Object.keys(patch).length && aiOn) {
        setVoiceMsg(t('score.voiceAiThinking'));
        const ai = await parseVoiceWithAI(
          transcript,
          holes.map((h) => ({ hole_number: h.hole_number, par: h.par })),
          sel.hole,
          mode,
        );
        if (__DEV__) console.log('[voice] ai', JSON.stringify(ai));
        if (ai) {
          holeNumber = ai.hole ?? sel.hole;
          target = holes.find((h) => h.hole_number === holeNumber);
          if (ai.strokes != null) patch.strokes = ai.strokes;
          if (ai.putts != null) patch.putts = ai.putts;
          viaAi = true;
        }
      }

      if (!target || !Object.keys(patch).length) {
        setVoiceMsg(t('score.voiceNotUnderstood'));
        return;
      }
      await updateHole(target, patch);
      // Show what was actually saved, so a misheard score is easy to spot and fix.
      const saved = [
        t('score.voiceSavedHole', { hole: target.hole_number }),
        patch.strokes == null
          ? null
          : mode === 'par'
            ? `${t('score.score')} ${displayScore(patch.strokes, target.par, mode)}`
            : t('score.voiceSavedStrokes', { count: patch.strokes }),
        patch.putts != null ? t('score.voiceSavedPutts', { count: patch.putts }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      setVoiceMsg(t(viaAi ? 'score.voiceAiSaved' : 'score.voiceSaved', { saved, text: transcript }));
      if (target.hole_number < holes.length) setSel({ hole: target.hole_number + 1, field: 'strokes' });
    },
    [holes, sel.hole, t, userId, mode],
  );

  const voice = useVoiceScore((p, text) => void onVoice(p, text));

  if (loading) return <Loading />;
  if (!data) return null;

  const totals = roundTotals(holes);
  const selectedHole = holeAt(sel.hole);
  const totalText = !totals.holesPlayed
    ? ''
    : mode === 'par'
      ? `${formatToPar(totals.toPar)} (${totals.strokes})`
      : `${totals.strokes} (${totals.toPar > 0 ? '+' : ''}${totals.toPar === 0 ? 'E' : totals.toPar})`;
  const changePar = (hole: RoundHole, par: number) => {
    if (par !== hole.par) void updateHole(hole, parChangePatch(hole, par, mode));
  };
  const nines = holes.length > 9 ? [1, 10] : [1];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topButton}>
          <Text style={{ color: c.primary, fontSize: 16 }}>‹ {t('common.done')}</Text>
        </Pressable>
        <Text style={[styles.course, { color: c.text }]} numberOfLines={1}>
          {data.round.course_name}
        </Text>
        <Text style={[styles.total, { color: c.text }]}>
          {totalText}
        </Text>
        {Platform.OS !== 'web' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('score.voice')}
            onPress={() => (voice.state === 'listening' ? voice.stop() : void voice.start())}
            style={[styles.mic, { backgroundColor: voice.state === 'listening' ? c.danger : c.primary }]}>
            <Text style={{ color: c.primaryText, fontWeight: '700' }}>
              {voice.state === 'listening'
                ? t('score.listening')
                : layout === 'landscape'
                  ? `🎙 ${t('score.voice')}`
                  : '🎙'}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={layout === 'portrait' ? t('score.switchToLandscape') : t('score.switchToPortrait')}
          onPress={toggleLayout}
          hitSlop={8}
          style={[styles.rotate, { borderColor: c.border, backgroundColor: c.surface }]}>
          <SymbolView
            name={{ ios: 'rectangle.portrait.rotate', android: 'screen_rotation', web: 'screen_rotation' }}
            tintColor={c.text}
            size={22}
          />
        </Pressable>
      </View>
      {(voice.state === 'listening' || voiceMsg || voice.state === 'denied') && (
        <Text style={[styles.voiceLine, { color: c.textMuted }]} numberOfLines={1}>
          {voice.state === 'denied'
            ? t('score.voicePermission')
            : voice.state === 'listening'
              ? voice.transcript || t('score.listening')
              : voiceMsg}
        </Text>
      )}

      {layout === 'portrait' ? (
        <View style={[styles.flex, { gap: spacing.sm, padding: spacing.sm }]}>
          <HoleTiles c={c} holes={holes} mode={mode} sel={sel} onSelect={setSel} />
          <TotalsLine c={c} holes={holes} mode={mode} totals={totals} />
          {selectedHole && (
            <View style={styles.bottomPad}>
              <InputPad
                c={c}
                wide={false}
                mode={mode}
                hole={selectedHole}
                field={sel.field}
                labels={{ hole: t('score.hole'), score: t('score.score'), putts: t('score.putts') }}
                onPick={(v) => setValue(selectedHole, sel.field, v)}
                onPar={(p) => changePar(selectedHole, p)}
                onField={(f) => setSel({ hole: sel.hole, field: f })}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.flex, { flexDirection: wide ? 'row' : 'column', gap: spacing.md, padding: spacing.sm }]}>
          <View style={[styles.flex, { gap: spacing.sm }]}>
            {nines.map((start) => (
              <NineGrid
                key={start}
                c={c}
                mode={mode}
                holes={holes.filter((h) => h.hole_number >= start && h.hole_number < start + 9)}
                subtotalLabel={start === 1 ? t('score.out') : t('score.in')}
                grandTotal={start === 10 || holes.length === 9 ? totals : null}
                coursePar={holes.reduce((sum, h) => sum + h.par, 0)}
                labels={{ hole: t('score.hole'), par: t('score.par'), score: t('score.score'), putts: t('score.putts'), total: t('score.total') }}
                sel={sel}
                onSelect={setSel}
              />
            ))}
          </View>
          {selectedHole && (
            <InputPad
              c={c}
              wide={wide}
              mode={mode}
              hole={selectedHole}
              field={sel.field}
              labels={{ hole: t('score.hole'), score: t('score.score'), putts: t('score.putts') }}
              onPick={(v) => setValue(selectedHole, sel.field, v)}
              onPar={(p) => changePar(selectedHole, p)}
              onField={(f) => setSel({ hole: sel.hole, field: f })}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const TILE_COLUMNS = 6;

/** Portrait: one tile per hole, 6 per row (18 holes → 3 rows, 9 holes → 2 rows). */
function HoleTiles({
  c,
  holes,
  mode,
  sel,
  onSelect,
}: {
  c: Colors;
  holes: RoundHole[];
  mode: EntryMode;
  sel: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useTranslation();
  const rows: RoundHole[][] = [];
  for (let i = 0; i < holes.length; i += TILE_COLUMNS) rows.push(holes.slice(i, i + TILE_COLUMNS));
  return (
    <View style={{ gap: spacing.xs }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: spacing.xs }}>
          {row.map((h) => {
            const selected = sel.hole === h.hole_number;
            return (
              <Pressable
                key={h.hole_number}
                accessibilityRole="button"
                accessibilityLabel={`${t('score.hole')} ${h.hole_number}`}
                onPress={() => onSelect({ hole: h.hole_number, field: 'strokes' })}
                style={[
                  styles.tile,
                  {
                    backgroundColor: selected ? c.selected : c.surface,
                    borderColor: selected ? c.primary : c.border,
                    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}>
                <View style={styles.tileHeader}>
                  <Text style={[styles.tileHole, { color: c.text }]}>{h.hole_number}</Text>
                  <Text style={[styles.tilePar, { color: c.textMuted }]}>P{h.par}</Text>
                </View>
                <Text style={[styles.tileScore, { color: scoreColor(c, h.strokes, h.par) }]}>{h.strokes == null ? '–' : displayScore(h.strokes, h.par, mode)}</Text>
                <Text
                  style={[
                    styles.tilePutts,
                    { color: selected && sel.field === 'putts' ? c.primary : c.textMuted },
                  ]}>
                  {h.putts != null ? `${h.putts}${t('score.puttsShort')}` : ' '}
                </Text>
              </Pressable>
            );
          })}
          {/* keep tile widths equal on a short last row */}
          {Array.from({ length: TILE_COLUMNS - row.length }, (_, i) => (
            <View key={`pad${i}`} style={[styles.tile, { borderWidth: 0 }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Portrait: Out / In / Total / Putts in one line under the tiles. */
function TotalsLine({
  c,
  holes,
  mode,
  totals,
}: {
  c: Colors;
  holes: RoundHole[];
  mode: EntryMode;
  totals: ReturnType<typeof roundTotals>;
}) {
  const { t } = useTranslation();
  const toPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
  const range = (from: number, to: number) => {
    const v = mode === 'par' ? toParRange(holes, from, to) : sumRange(holes, from, to, 'strokes');
    return v == null ? '–' : mode === 'par' ? formatToPar(v) : String(v);
  };
  const total = !totals.holesPlayed
    ? '–'
    : mode === 'par'
      ? `${formatToPar(totals.toPar)} (${totals.strokes})`
      : `${totals.strokes} (${toPar(totals.toPar)})`;
  const parts = [
    `${t('score.out')} ${range(1, 9)}`,
    holes.length > 9 ? `${t('score.in')} ${range(10, 18)}` : null,
    `${t('score.total')} ${total}`,
    `${t('score.putts')} ${totals.putts ?? '–'}`,
  ].filter(Boolean);
  return (
    <Text style={[styles.totalsLine, { color: c.textMuted }]} numberOfLines={1}>
      {parts.join('  ·  ')}
    </Text>
  );
}

function NineGrid({
  c,
  mode,
  holes,
  subtotalLabel,
  grandTotal,
  coursePar,
  labels,
  sel,
  onSelect,
}: {
  c: Colors;
  mode: EntryMode;
  holes: RoundHole[];
  subtotalLabel: string;
  grandTotal: ReturnType<typeof roundTotals> | null;
  coursePar: number;
  labels: { hole: string; par: string; score: string; putts: string; total: string };
  sel: Selection;
  onSelect: (s: Selection) => void;
}) {
  if (!holes.length) return null;
  const from = holes[0].hole_number;
  const to = holes[holes.length - 1].hole_number;
  const sub = (k: 'par' | 'strokes' | 'putts') => sumRange(holes, from, to, k) ?? '';
  const subScore = () => {
    if (mode === 'stroke') return sub('strokes');
    const v = toParRange(holes, from, to);
    return v == null ? '' : formatToPar(v);
  };
  const totalScore = !grandTotal?.holesPlayed ? '' : mode === 'par' ? formatToPar(grandTotal.toPar) : grandTotal.strokes;

  const cell = (
    content: string | number,
    opts: { header?: boolean; label?: boolean; color?: string; bg?: string; onPress?: () => void; key: string },
  ) => (
    <Pressable
      key={opts.key}
      onPress={opts.onPress}
      disabled={!opts.onPress}
      style={[
        styles.cell,
        opts.label && styles.labelCell,
        { borderColor: c.border, backgroundColor: opts.bg ?? (opts.header ? c.surfaceAlt : c.surface) },
      ]}>
      <Text
        numberOfLines={1}
        style={[styles.cellText, opts.label && styles.labelText, { color: opts.color ?? c.text, fontWeight: opts.header ? '600' : '700' }]}>
        {content}
      </Text>
    </Pressable>
  );

  const row = (label: string, key: string, render: (h: RoundHole) => ReturnType<typeof cell>, subtotal: string | number, total?: string | number) => (
    <View style={styles.gridRow} key={key}>
      {cell(label, { header: true, key: `${key}-label`, label: true })}
      {holes.map(render)}
      {cell(subtotal, { header: true, key: `${key}-sub` })}
      {grandTotal && cell(total ?? '', { header: true, key: `${key}-tot` })}
    </View>
  );

  const isSel = (h: RoundHole, f: Field) => sel.hole === h.hole_number && sel.field === f;

  return (
    <View style={[styles.grid, { borderColor: c.border }]}>
      {row(labels.hole, 'hole', (h) => cell(h.hole_number, { header: true, key: `h${h.hole_number}` }), subtotalLabel, grandTotal ? labels.total : undefined)}
      {row(labels.par, 'par', (h) => cell(h.par, { header: true, key: `p${h.hole_number}` }), sub('par'), grandTotal ? coursePar : undefined)}
      {row(
        labels.score,
        'score',
        (h) =>
          cell(displayScore(h.strokes, h.par, mode), {
            key: `s${h.hole_number}`,
            color: scoreColor(c, h.strokes, h.par),
            bg: isSel(h, 'strokes') ? c.selected : undefined,
            onPress: () => onSelect({ hole: h.hole_number, field: 'strokes' }),
          }),
        subScore(),
        totalScore,
      )}
      {row(
        labels.putts,
        'putts',
        (h) =>
          cell(h.putts ?? '', {
            key: `u${h.hole_number}`,
            bg: isSel(h, 'putts') ? c.selected : undefined,
            onPress: () => onSelect({ hole: h.hole_number, field: 'putts' }),
          }),
        sub('putts'),
        grandTotal?.putts ?? '',
      )}
    </View>
  );
}

const TERM_KEYS: Record<number, string> = { [-2]: 'stats.eagleOrBetter', [-1]: 'stats.birdie', 0: 'stats.par', 1: 'stats.bogey', 2: 'stats.double' };

const PAR_CHOICES = [3, 4, 5];

function InputPad({
  c,
  wide,
  mode,
  hole,
  field,
  labels,
  onPick,
  onPar,
  onField,
}: {
  c: Colors;
  wide: boolean;
  mode: EntryMode;
  hole: RoundHole;
  field: Field;
  labels: { hole: string; score: string; putts: string };
  onPick: (v: number | null) => void;
  onPar: (par: number) => void;
  onField: (f: Field) => void;
}) {
  const { t } = useTranslation();
  const values = field === 'strokes' ? padStrokes(hole.par, mode) : [0, 1, 2, 3, 4, 5];
  const current = hole[field];

  return (
    <View style={[styles.pad, { width: wide ? 240 : '100%', backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.parRow}>
        <Text style={{ color: c.textMuted, fontWeight: '600' }}>
          {t('score.par')}
        </Text>
        {PAR_CHOICES.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityState={{ selected: hole.par === p }}
            accessibilityLabel={`${t('score.par')} ${p}`}
            onPress={() => onPar(p)}
            hitSlop={4}
            style={[styles.parKey, { backgroundColor: hole.par === p ? c.text : c.bg, borderColor: c.border }]}>
            <Text style={{ fontWeight: '700', color: hole.par === p ? c.bg : c.text }}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {(['strokes', 'putts'] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => onField(f)}
            style={[styles.padTab, { backgroundColor: field === f ? c.primary : c.surfaceAlt }]}>
            <Text style={{ color: field === f ? c.primaryText : c.text, fontWeight: '600' }}>
              {labels.hole} {hole.hole_number} · {f === 'strokes' ? labels.score : labels.putts}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* Same height for the strokes (3 rows) and putts (2 rows) pads, so the tabs and keys
          don't move under the thumb when the pad switches after a stroke entry. */}
      <View style={[styles.padGrid, { minHeight: (wide ? 46 : 60) * 3 + spacing.xs * 2 }]}>
        {values.map((v) => {
          const term = field === 'strokes' ? TERM_KEYS[v - hole.par] : undefined;
          const active = current === v;
          return (
            <Pressable
              key={v}
              onPress={() => onPick(v)}
              style={({ pressed }) => [
                styles.padKey,
                !wide && styles.padKeyLarge,
                {
                  backgroundColor: active ? c.primary : v === hole.par && field === 'strokes' ? c.surfaceAlt : c.bg,
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: active ? c.primaryText : field === 'strokes' ? scoreColor(c, v, hole.par) : c.text }}>
                {field === 'strokes' ? displayScore(v, hole.par, mode) : v}
              </Text>
              {term && <Text style={{ fontSize: 10, color: active ? c.primaryText : c.textMuted }}>{t(term)}</Text>}
            </Pressable>
          );
        })}
        <Pressable onPress={() => onPick(null)} style={[styles.padKey, !wide && styles.padKeyLarge, { borderColor: c.border, backgroundColor: c.bg }]}>
          <Text style={{ color: c.danger, fontWeight: '600' }}>⌫</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  topButton: { paddingVertical: spacing.xs },
  course: { flex: 1, fontSize: 17, fontWeight: '700' },
  total: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mic: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  rotate: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomPad: { marginTop: 'auto' },
  tile: { flex: 1, minHeight: 74, borderRadius: radius.sm, padding: 4, justifyContent: 'space-between' },
  tileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileHole: { fontSize: 13, fontWeight: '700' },
  tilePar: { fontSize: 11 },
  tileScore: { fontSize: 24, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  tilePutts: { fontSize: 11, textAlign: 'center' },
  totalsLine: { fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  voiceLine: { paddingHorizontal: spacing.md, fontSize: 13 },
  grid: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  cellText: { fontSize: 16, fontVariant: ['tabular-nums'] },
  labelCell: { flex: 1.7 },
  labelText: { fontSize: 13 },
  pad: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  parRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  parKey: {
    minWidth: 40,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  padTab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignContent: 'flex-start' },
  padKeyLarge: { minHeight: 60 }, // portrait: bigger targets (gloves, sunlight)
  padKey: {
    width: '18.4%',
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
