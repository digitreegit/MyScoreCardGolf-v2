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
}

const EN_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18,
};

const KO_NATIVE_COUNT: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };
const KO_KONGLISH_COUNT: Record<string, number> = { 원: 1, 투: 2, 쓰리: 3, 포: 4 };

type TermRule = { re: RegExp; toPar?: number; strokes?: number; doublePar?: true };

// Order matters: longer / more specific phrases first.
const TERM_RULES: TermRule[] = [
  { re: /__ace__|홀인원/, strokes: 1 },
  { re: /\bdouble par\b|양파/, doublePar: true },
  { re: /\b(albatross|double eagle)\b|알바트로스/, toPar: -3 },
  { re: /\beagle\b|이글/, toPar: -2 },
  { re: /\bbirdie\b|버디/, toPar: -1 },
  { re: /\b(quadruple|quad)( bogey)?\b|쿼드러플|쿼드/, toPar: 4 },
  { re: /\btriple( bogey)?\b|트리플/, toPar: 3 },
  { re: /\bdouble( bogey)?\b|더블/, toPar: 2 },
  { re: /\bbogey\b|보기/, toPar: 1 },
  { re: /\bpar\b|파/, toPar: 0 },
];

function normalize(text: string): string {
  let s = ` ${text.toLowerCase().replace(/[-,.!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // Protect "hole in one" before number words are converted to digits.
  s = s.replace(/\bhole in (one|1)\b/g, ' __ace__ ').replace(/\bace\b/g, ' __ace__ ');
  s = s.replace(/\b[a-z]+\b/g, (w) => (w in EN_NUMBERS ? String(EN_NUMBERS[w]) : w));
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
    [/(한|두|세|네) ?(번 ?)?퍼트/, (m) => KO_NATIVE_COUNT[m[1]]],
    [/(원|투|쓰리|포) ?퍼트/, (m) => KO_KONGLISH_COUNT[m[1]]],
  ];
  for (const [re, value] of rules) {
    const { match, rest } = take(s, re);
    if (match) return { putts: value(match), rest };
  }
  return { putts: null, rest: s };
}

function parseHole(s: string): { hole: number | null; rest: string } {
  const rules = [/\bhole (?:number )?(\d{1,2})\b/, /\bnumber (\d{1,2})\b/, /(\d{1,2}) ?(?:번 ?홀|홀|번)/];
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
      s.match(/\b(?:shot|made|got|scored|score|had|took|carded) (?:a )?(\d{1,2})\b/) ?? s.match(/(\d{1,2}) ?타/);
    const bare = explicit ?? s.match(/\b(\d{1,2})\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n >= 1 && n <= 15) strokes = n;
    }
  }

  if (h.hole == null && strokes == null && toPar == null && !doublePar && p.putts == null) return null;
  return { hole: h.hole, strokes, toPar, doublePar, putts: p.putts };
}

/** Converts a parsed utterance into absolute strokes for a hole with the given par. */
export function resolveStrokes(parsed: ParsedScore, par: number): number | null {
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
