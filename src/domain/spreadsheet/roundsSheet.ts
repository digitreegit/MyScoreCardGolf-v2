// Pure conversion between rounds and spreadsheet rows (one row per round, "wide" layout).
// The xlsx/csv file handling lives in ./workbook.ts so this file stays dependency-free.

import { TEE_BOXES, type Round, type RoundHole, type RoundWithHoles, type TeeBox } from '../types';
import { roundTotals } from '../stats';

export const MAX_HOLES = 18;
export const BASE_COLUMNS = ['Date', 'Course', 'Tee', 'Companions', 'Holes', 'Notes'] as const;
export const parCol = (n: number) => `Par ${n}`;
export const scoreCol = (n: number) => `Score ${n}`;
export const puttsCol = (n: number) => `Putts ${n}`;
export const TOTAL_COLUMNS = ['Total', 'To Par', 'Total Putts'] as const; // export only, ignored on import

export function sheetHeader(): string[] {
  const holes = Array.from({ length: MAX_HOLES }, (_, i) => i + 1);
  return [
    ...BASE_COLUMNS,
    ...holes.map(parCol),
    ...holes.map(scoreCol),
    ...holes.map(puttsCol),
    ...TOTAL_COLUMNS,
  ];
}

export type SheetCell = string | number | null;
export type SheetRow = Record<string, SheetCell>;

/**
 * Spreadsheet apps execute cells starting with these characters as formulas
 * ("CSV injection"). Prefix with a quote so user text is always shown as text.
 */
export function escapeCellText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function roundsToRows(items: RoundWithHoles[]): SheetRow[] {
  return items
    .filter((r) => !r.round.deleted_at)
    .sort((a, b) => a.round.played_on.localeCompare(b.round.played_on))
    .map(({ round, holes }) => {
      const row: SheetRow = {
        Date: round.played_on,
        Course: escapeCellText(round.course_name),
        Tee: round.tee_box ?? '',
        Companions: escapeCellText(round.companions),
        Holes: round.holes_count,
        Notes: escapeCellText(round.notes),
      };
      const byNumber = new Map(holes.map((h) => [h.hole_number, h]));
      for (let n = 1; n <= MAX_HOLES; n++) {
        const h = byNumber.get(n);
        row[parCol(n)] = h?.par ?? null;
        row[scoreCol(n)] = h?.strokes ?? null;
        row[puttsCol(n)] = h?.putts ?? null;
      }
      const t = roundTotals(holes);
      row.Total = t.holesPlayed ? t.strokes : null;
      row['To Par'] = t.holesPlayed ? t.toPar : null;
      row['Total Putts'] = t.putts;
      return row;
    });
}

export interface ImportError {
  row: number; // 1-based spreadsheet row, header = row 1
  message: string;
}

export interface ImportResult {
  items: RoundWithHoles[];
  errors: ImportError[];
}

function toInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : NaN;
}

function stripEscape(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s.startsWith("'") ? s.slice(1) : s;
}

/** Accepts Date objects, YYYY-MM-DD, US M/D/YYYY, and Excel serial day numbers. */
export function parseSheetDate(v: unknown): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  return null;
}

export function rowsToRounds(
  rows: SheetRow[],
  opts: { userId: string | null; newId: () => string; now: string },
): ImportResult {
  const items: RoundWithHoles[] = [];
  const errors: ImportError[] = [];

  rows.forEach((row, idx) => {
    const rowNo = idx + 2;
    const fail = (message: string) => errors.push({ row: rowNo, message });

    const playedOn = parseSheetDate(row.Date);
    if (!playedOn) return fail('Invalid or missing Date (use YYYY-MM-DD)');
    const courseName = stripEscape(row.Course);
    if (!courseName) return fail('Missing Course');

    const holesCount = toInt(row.Holes) ?? MAX_HOLES;
    if (holesCount !== 9 && holesCount !== 18) return fail('Holes must be 9 or 18');

    const teeRaw = stripEscape(row.Tee).toLowerCase();
    const tee = (TEE_BOXES as string[]).includes(teeRaw) ? (teeRaw as TeeBox) : null;

    const id = opts.newId();
    const holes: RoundHole[] = [];
    for (let n = 1; n <= holesCount; n++) {
      const par = toInt(row[parCol(n)]) ?? 4;
      const strokes = toInt(row[scoreCol(n)]);
      const putts = toInt(row[puttsCol(n)]);
      if (Number.isNaN(par) || par < 3 || par > 6) return fail(`${parCol(n)} must be 3-6`);
      if (Number.isNaN(strokes) || (strokes != null && (strokes < 1 || strokes > 20))) {
        return fail(`${scoreCol(n)} must be 1-20`);
      }
      if (Number.isNaN(putts) || (putts != null && (putts < 0 || putts > 10))) {
        return fail(`${puttsCol(n)} must be 0-10`);
      }
      holes.push({
        round_id: id,
        user_id: opts.userId,
        hole_number: n,
        par,
        strokes,
        putts,
        fairway: null,
        penalties: null,
        updated_at: opts.now,
      });
    }

    const round: Round = {
      id,
      user_id: opts.userId,
      course_id: null,
      course_name: courseName,
      tee_box: tee,
      companions: stripEscape(row.Companions),
      played_on: playedOn,
      holes_count: holesCount,
      entry_mode: 'stroke',
      exclude_from_stats: false,
      notes: stripEscape(row.Notes),
      source: 'import',
      created_at: opts.now,
      updated_at: opts.now,
      deleted_at: null,
    };
    items.push({ round, holes });
  });

  return { items, errors };
}
