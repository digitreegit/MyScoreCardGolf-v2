// Shape returned by the scan-scorecard edge function, and its conversion into a round.

import { DEFAULT_PARS_18, todayLocalDate, type Round, type RoundHole, type RoundWithHoles } from './types';

export interface ScanResult {
  course_name: string | null;
  played_on: string | null;
  holes_count: 9 | 18;
  notation: 'strokes' | 'to_par';
  pars: Array<number | null>;
  players: Array<{ name: string | null; scores: Array<number | null>; putts: Array<number | null> }>;
  confidence: 'high' | 'medium' | 'low';
}

export function scanToRound(
  scan: ScanResult,
  playerIndex: number,
  opts: { userId: string | null; newId: () => string; now: string },
): RoundWithHoles {
  const player = scan.players[playerIndex];
  const holesCount = scan.holes_count === 9 ? 9 : 18;
  const id = opts.newId();

  const holes: RoundHole[] = Array.from({ length: holesCount }, (_, i) => {
    const scannedPar = scan.pars[i];
    const par = scannedPar != null && scannedPar >= 3 && scannedPar <= 6 ? scannedPar : DEFAULT_PARS_18[i];
    const raw = player?.scores[i] ?? null;
    const strokes = raw == null ? null : scan.notation === 'to_par' ? par + raw : raw;
    const putts = player?.putts[i] ?? null;
    return {
      round_id: id,
      user_id: opts.userId,
      hole_number: i + 1,
      par,
      strokes: strokes != null && strokes >= 1 && strokes <= 20 ? strokes : null,
      putts: putts != null && putts >= 0 && putts <= 10 ? putts : null,
      fairway: null,
      penalties: null,
      updated_at: opts.now,
    };
  });

  const playedOn = scan.played_on && /^\d{4}-\d{2}-\d{2}$/.test(scan.played_on) ? scan.played_on : todayLocalDate();
  const round: Round = {
    id,
    user_id: opts.userId,
    course_id: null,
    course_name: scan.course_name?.trim() || 'Scanned round',
    tee_box: null,
    companions: scan.players
      .filter((_, i) => i !== playerIndex)
      .map((p) => p.name)
      .filter(Boolean)
      .join(', '),
    played_on: playedOn,
    holes_count: holesCount,
    entry_mode: 'stroke',
    exclude_from_stats: false,
    notes: '',
    source: 'scan',
    created_at: opts.now,
    updated_at: opts.now,
    deleted_at: null,
  };
  return { round, holes };
}
