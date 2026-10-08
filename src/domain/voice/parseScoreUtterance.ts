import type { EntryMode } from '../types';

// Rule-based parser for spoken score entry. Runs on-device on the transcript produced by
// the OS speech recognizer. English and Korean are supported side by side, so a bilingual
// golfer can mix them ("7번 bogey two putts"). Unrecognized phrases return null and the
// UI can fall back to the server-side LLM parser later.

export interface ParsedScore {
  hole: number | null;
  /** Absolute strokes ("shot a 5", "5타", "hole in one"). */
  strokes: number | null;
  /** Strokes relative to par ("bogey" = +1, "birdie" = -1). */
  toPar: number | null;
  /** Korean "양파": double par. */
  doublePar: boolean;
  putts: number | null;
  /** A number said on its own ("hole 7, 2"): strokes in stroke mode, strokes over par in par mode. */
  bare: number | null;
  /** True when the result relied on correcting likely mishearings (part→par, pets→putts, or→hole…). */
  guessed: boolean;
}

const EN_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18,
};

const KO_NATIVE_COUNT: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };
// Native Korean counts used for strokes ("다섯 개", "여섯 타").
const KO_NATIVE_NUMBERS: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};
const KO_SINO_DIGITS: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };

/** "칠" → 7, "십이" → 12, "십팔" → 18 (Sino-Korean, used for hole numbers). */
function sinoKorean(word: string): number | null {
  const m = word.match(/^([일이삼사오육칠팔구])?(십)?([일이삼사오육칠팔구])?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  if (!m[2]) return m[3] ? null : KO_SINO_DIGITS[m[1]];
  return (m[1] ? KO_SINO_DIGITS[m[1]] : 1) * 10 + (m[3] ? KO_SINO_DIGITS[m[3]] : 0);
}
const KO_KONGLISH_COUNT: Record<string, number> = { 원: 1, 투: 2, 쓰리: 3, 포: 4 };

type TermRule = { re: RegExp; toPar?: number; strokes?: number; doublePar?: true };

// Order matters: longer / more specific phrases first.
const TERM_RULES: TermRule[] = [
  { re: /__ace__|홀인원/, strokes: 1 },
  { re: /\bdouble par\b|양파/, doublePar: true },
  { re: /\b(albatross|double eagle)\b|알바트로스/, toPar: -3 },
  { re: /\beagle\b|이글/, toPar: -2 },
  { re: /\bbird(?:ie|y)\b|버디/, toPar: -1 },
  { re: /\b(quadruple|quad)( bog(?:ey|ie|y))?\b|쿼드러플|쿼드/, toPar: 4 },
  { re: /\btriple( bog(?:ey|ie|y))?\b|트리플/, toPar: 3 },
  { re: /\bdouble( bog(?:ey|ie|y))?\b|더블/, toPar: 2 },
  { re: /\bbog(?:ey|ie|y)\b|보기/, toPar: 1 },
  { re: /\bparr?\b|파/, toPar: 0 },
];

let guessed = false; // set by normalize() for the utterance being parsed

function normalize(text: string): string {
  guessed = false;
  let s = ` ${text.toLowerCase().replace(/[-,.!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // Protect "hole in one" before number words are converted to digits.
  s = s.replace(/\bhole in (one|1)\b/g, ' __ace__ ').replace(/\bace\b/g, ' __ace__ ');
  s = s.replace(/\b[a-z]+\b/g, (w) => (w in EN_NUMBERS ? String(EN_NUMBERS[w]) : w));
  // Recognizer mishearings seen in testing ("hole one par two putts" → "or one part two pets").
  // Each correction marks the result as guessed so the optional AI fallback can double-check it.
  const before = s;
  s = s.replace(/\bwhole\b/g, 'hole');
  s = s.replace(/^ (?:or|all|hold|hall) (?=\d)/, ' hole ');
  s = s.replace(/\bpart\b/g, 'par');
  s = s.replace(/(\d) ?(?:pets?|puts?|pots?|putz|pats?|parts)\b/g, '$1 putts');
  s = s.replace(/\bboogie\b/g, 'bogey').replace(/\bbertie\b/g, 'birdie');
  guessed = s !== before;
  // Korean: "이번 홀" means "this hole" (the selected one), not hole 2 — drop it before numerals.
  // ("십이번 홀" is hole 12, so only a standalone 이번 counts.)
  s = s.replace(/(^|[^일이삼사오육칠팔구십])이번 ?홀/g, '$1 ');
  // Sino-Korean hole numbers ("칠번 홀", "십팔 번") and native stroke counts ("다섯 개").
  s = s.replace(/([일이삼사오육칠팔구십]+) ?(?=번|홀)/g, (w, word: string) => {
    const n = sinoKorean(word);
    return n == null ? w : String(n);
  });
  s = s.replace(/(하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열) ?(개|타)/g, (_w, word: string) => `${KO_NATIVE_NUMBERS[word]}타`);
  return s;
}

function take(s: string, re: RegExp): { match: RegExpMatchArray | null; rest: string } {
  const match = s.match(re);
  if (!match || match.index == null) return { match: null, rest: s };
  return { match, rest: `${s.slice(0, match.index)} ${s.slice(match.index + match[0].length)}` };
}

function parsePutts(s: string): { putts: number | null; rest: string } {
  const rules: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
    [/\bchip(ped)? ?in\b|칩인/, () => 0],
    [/\b(no|0) putts?\b/, () => 0],
    [/\b(to|too) putt(s|ed)?\b/, () => 2],
    [/\b(\d) ?putt(s|ed)?\b/, (m) => Number(m[1])],
    [/(\d) ?(번 ?)?퍼트/, (m) => Number(m[1])],
    // The ko-KR recognizer sometimes mixes scripts: "파투 putt" for "파 투 퍼트".
    [/(한|두|세|네) ?(번 ?)?(?:퍼트|putts?)/, (m) => KO_NATIVE_COUNT[m[1]]],
    [/(원|투|쓰리|포) ?(?:퍼트|putts?)/, (m) => KO_KONGLISH_COUNT[m[1]]],
  ];
  for (const [re, value] of rules) {
    const { match, rest } = take(s, re);
    if (match) return { putts: value(match), rest };
  }
  return { putts: null, rest: s };
}

function parseHole(s: string): { hole: number | null; rest: string } {
  const rules = [
    /\bhole (?:number )?(\d{1,2})\b/,
    /\bnumber (\d{1,2})\b/,
    /(\d{1,2}) ?(?:번 ?홀|홀|번)/,
    /\b(?:on|at) (\d{1,2})\b/, // "birdie on 3", "made a five on 6"
  ];
  for (const re of rules) {
    const { match, rest } = take(s, re);
    if (match) {
      const n = Number(match[1]);
      if (n >= 1 && n <= 36) return { hole: n, rest };
    }
  }
  return { hole: null, rest: s };
}

function parseRelative(s: string): { toPar: number | null; rest: string } {
  const rules: Array<[RegExp, number]> = [
    [/\b(?:plus|over) (\d)\b|플러스 ?(\d)/, 1],
    [/\b(?:minus|under) (\d)\b|마이너스 ?(\d)/, -1],
    [/(?:^|\s)\+ ?(\d)\b/, 1],
  ];
  for (const [re, sign] of rules) {
    const { match, rest } = take(s, re);
    if (match) return { toPar: sign * Number(match[1] ?? match[2]), rest };
  }
  return { toPar: null, rest: s };
}

export function parseScoreUtterance(text: string): ParsedScore | null {
  let s = normalize(text);

  const p = parsePutts(s);
  s = p.rest;
  const h = parseHole(s);
  s = h.rest;

  let strokes: number | null = null;
  let toPar: number | null = null;
  let doublePar = false;
  let bare: number | null = null;

  for (const rule of TERM_RULES) {
    const { match, rest } = take(s, rule.re);
    if (!match) continue;
    s = rest;
    if (rule.strokes != null) strokes = rule.strokes;
    if (rule.toPar != null) toPar = rule.toPar;
    if (rule.doublePar) doublePar = true;
    break;
  }

  if (strokes == null && toPar == null && !doublePar) {
    const rel = parseRelative(s);
    s = rel.rest;
    toPar = rel.toPar;
  }

  if (strokes == null && toPar == null && !doublePar) {
    const explicit =
      s.match(/\b(?:shot|made|got|scored|score|had|took|carded) (?:a )?(\d{1,2})\b/) ?? s.match(/(\d{1,2}) ?(?:타|개)/);
    const lone = s.match(/\b(\d{1,2})\b/);
    const n = explicit ? Number(explicit[1]) : lone ? Number(lone[1]) : NaN;
    if (!explicit && n >= 0 && n <= 9) bare = n;
    // A lone "1" is almost always a misheard word; a hole-in-one must be said as such ("ace").
    const min = explicit ? 1 : 2;
    if (n >= min && n <= 15) strokes = n;
  }

  if (h.hole == null && strokes == null && toPar == null && !doublePar && p.putts == null && bare == null) return null;
  return { hole: h.hole, strokes, toPar, doublePar, putts: p.putts, bare, guessed };
}

/**
 * Converts a parsed utterance into absolute strokes for a hole with the given par. In par mode a
 * number said on its own is over/under par, matching how the card is written ("2" = double bogey).
 */
export function resolveStrokes(parsed: ParsedScore, par: number, mode: EntryMode = 'stroke'): number | null {
  if (mode === 'par' && parsed.bare != null) return Math.max(1, par + parsed.bare);
  if (parsed.strokes != null) return parsed.strokes;
  if (parsed.doublePar) return par * 2;
  if (parsed.toPar != null) return Math.max(1, par + parsed.toPar);
  return null;
}

/** Hints passed to the OS recognizer (iOS contextualStrings) to bias toward golf vocabulary. */
export const VOICE_CONTEXT_HINTS = [
  'birdie', 'bogey', 'double bogey', 'triple bogey', 'eagle', 'par', 'putt', 'putts', 'hole in one', 'chip in',
  '버디', '보기', '더블보기', '트리플', '이글', '파', '퍼트', '양파', '홀인원',
];
