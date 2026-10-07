// Landscape score entry (18Birdies-style): full card on screen, tap a cell, tap a number.
// Entering strokes jumps to that hole's putts; entering putts jumps to the next hole.

import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRound } from '@/data/hooks';
import { updateHole } from '@/data/repository';
import { roundTotals, sumRange } from '@/domain/stats';
import type { RoundHole } from '@/domain/types';
import type { ParsedScore } from '@/domain/voice/parseScoreUtterance';
import { resolveStrokes } from '@/domain/voice/parseScoreUtterance';
import { useVoiceScore } from '@/features/voice/useVoiceScore';
import { Loading } from '@/ui/components';
import { radius, scoreColor, spacing, useColors, type Colors } from '@/ui/theme';

type Field = 'strokes' | 'putts';
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

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      };
    }, []),
  );

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

  const onVoice = useCallback(
    async (parsed: ParsedScore | null, transcript: string) => {
      const target = parsed ? holes.find((h) => h.hole_number === (parsed.hole ?? sel.hole)) : undefined;
      if (!parsed || !target) {
        setVoiceMsg(t('score.voiceNotUnderstood'));
        return;
      }
      const strokes = resolveStrokes(parsed, target.par);
      const patch: Partial<RoundHole> = {};
      if (strokes != null) patch.strokes = strokes;
      if (parsed.putts != null) patch.putts = parsed.putts;
      if (!Object.keys(patch).length) {
        setVoiceMsg(t('score.voiceNotUnderstood'));
        return;
      }
      await updateHole(target, patch);
      setVoiceMsg(t('score.voiceHeard', { text: transcript }));
      if (target.hole_number < holes.length) setSel({ hole: target.hole_number + 1, field: 'strokes' });
    },
    [holes, sel.hole, t],
  );

  const voice = useVoiceScore((p, text) => void onVoice(p, text));

  if (loading) return <Loading />;
  if (!data) return null;

  const totals = roundTotals(holes);
  const selectedHole = holeAt(sel.hole);
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
          {totals.holesPlayed ? `${totals.strokes} (${totals.toPar > 0 ? '+' : ''}${totals.toPar === 0 ? 'E' : totals.toPar})` : ''}
        </Text>
        {Platform.OS !== 'web' && (
          <Pressable
            onPress={() => (voice.state === 'listening' ? voice.stop() : void voice.start())}
            style={[styles.mic, { backgroundColor: voice.state === 'listening' ? c.danger : c.primary }]}>
            <Text style={{ color: c.primaryText, fontWeight: '700' }}>
              {voice.state === 'listening' ? t('score.listening') : `🎙 ${t('score.voice')}`}
            </Text>
          </Pressable>
        )}
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

      <View style={[styles.flex, { flexDirection: wide ? 'row' : 'column', gap: spacing.md, padding: spacing.sm }]}>
        <View style={[styles.flex, { gap: spacing.sm }]}>
          {nines.map((start) => (
            <NineGrid
              key={start}
              c={c}
              holes={holes.filter((h) => h.hole_number >= start && h.hole_number < start + 9)}
              subtotalLabel={start === 1 ? t('score.out') : t('score.in')}
              grandTotal={start === 10 || holes.length === 9 ? totals : null}
              coursePar={holes.reduce((sum, h) => sum + h.par, 0)}
              labels={{ hole: t('score.hole'), par: t('score.par'), score: t('score.score'), putts: t('score.putts'), total: t('score.total') }}
              sel={sel}
              onSelect={setSel}
            />
          ))}
          {!wide && <Text style={{ color: c.textMuted, textAlign: 'center' }}>{t('score.rotateHint')}</Text>}
        </View>
        {selectedHole && (
          <InputPad
            c={c}
            wide={wide}
            hole={selectedHole}
            field={sel.field}
            labels={{ hole: t('score.hole'), score: t('score.score'), putts: t('score.putts') }}
            onPick={(v) => setValue(selectedHole, sel.field, v)}
            onField={(f) => setSel({ hole: sel.hole, field: f })}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function NineGrid({
  c,
  holes,
  subtotalLabel,
  grandTotal,
  coursePar,
  labels,
  sel,
  onSelect,
}: {
  c: Colors;
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
          cell(h.strokes ?? '', {
            key: `s${h.hole_number}`,
            color: scoreColor(c, h.strokes, h.par),
            bg: isSel(h, 'strokes') ? c.selected : undefined,
            onPress: () => onSelect({ hole: h.hole_number, field: 'strokes' }),
          }),
        sub('strokes'),
        grandTotal?.holesPlayed ? grandTotal.strokes : '',
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

function InputPad({
  c,
  wide,
  hole,
  field,
  labels,
  onPick,
  onField,
}: {
  c: Colors;
  wide: boolean;
  hole: RoundHole;
  field: Field;
  labels: { hole: string; score: string; putts: string };
  onPick: (v: number | null) => void;
  onField: (f: Field) => void;
}) {
  const { t } = useTranslation();
  const values = field === 'strokes' ? Array.from({ length: 10 }, (_, i) => i + 1) : [0, 1, 2, 3, 4, 5];
  const current = hole[field];

  return (
    <View style={[styles.pad, { width: wide ? 240 : '100%', backgroundColor: c.surface, borderColor: c.border }]}>
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
      <View style={styles.padGrid}>
        {values.map((v) => {
          const term = field === 'strokes' ? TERM_KEYS[v - hole.par] : undefined;
          const active = current === v;
          return (
            <Pressable
              key={v}
              onPress={() => onPick(v)}
              style={({ pressed }) => [
                styles.padKey,
                {
                  backgroundColor: active ? c.primary : v === hole.par && field === 'strokes' ? c.surfaceAlt : c.bg,
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: active ? c.primaryText : field === 'strokes' ? scoreColor(c, v, hole.par) : c.text }}>
                {v}
              </Text>
              {term && <Text style={{ fontSize: 10, color: active ? c.primaryText : c.textMuted }}>{t(term)}</Text>}
            </Pressable>
          );
        })}
        <Pressable onPress={() => onPick(null)} style={[styles.padKey, { borderColor: c.border, backgroundColor: c.bg }]}>
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
  voiceLine: { paddingHorizontal: spacing.md, fontSize: 13 },
  grid: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  cellText: { fontSize: 16, fontVariant: ['tabular-nums'] },
  labelCell: { flex: 1.7 },
  labelText: { fontSize: 13 },
  pad: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  padTab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  padKey: {
    width: '18.4%',
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
