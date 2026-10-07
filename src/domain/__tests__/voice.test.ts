import { describe, expect, it } from '@jest/globals';

import { parseScoreUtterance, resolveStrokes } from '../voice/parseScoreUtterance';

describe('parseScoreUtterance (English)', () => {
  it('parses hole, term and putts', () => {
    expect(parseScoreUtterance('Hole 7 bogey, two putts')).toEqual({
      hole: 7,
      strokes: null,
      toPar: 1,
      doublePar: false,
      putts: 2,
    });
  });

  it('prefers "double bogey" over "bogey"', () => {
    expect(parseScoreUtterance('double bogey')?.toPar).toBe(2);
  });

  it('reads bare numbers as strokes once hole and putts are removed', () => {
    const r = parseScoreUtterance('hole seven five two putts');
    expect(r).toMatchObject({ hole: 7, strokes: 5, putts: 2 });
  });

  it('handles hole in one without treating "one" as a number', () => {
    expect(parseScoreUtterance('hole in one on number 3')).toMatchObject({ hole: 3, strokes: 1 });
  });

  it('handles chip-ins and explicit scores', () => {
    expect(parseScoreUtterance('made a 4 chipped in')).toMatchObject({ strokes: 4, putts: 0 });
  });

  it('handles plus/minus relative scores', () => {
    expect(parseScoreUtterance('hole 2 plus 3')?.toPar).toBe(3);
  });

  it('returns null for unrelated speech', () => {
    expect(parseScoreUtterance('nice weather today')).toBeNull();
  });
});

describe('parseScoreUtterance (Korean)', () => {
  it('parses 번홀 + term + 퍼트', () => {
    expect(parseScoreUtterance('7번홀 보기 2퍼트')).toMatchObject({ hole: 7, toPar: 1, putts: 2 });
  });

  it('parses native and Konglish putt counts', () => {
    expect(parseScoreUtterance('3번 파 두 번 퍼트')).toMatchObject({ hole: 3, toPar: 0, putts: 2 });
    expect(parseScoreUtterance('더블 쓰리퍼트')).toMatchObject({ toPar: 2, putts: 3 });
  });

  it('parses 타 and 양파', () => {
    expect(parseScoreUtterance('12번 홀 6타')).toMatchObject({ hole: 12, strokes: 6 });
    expect(parseScoreUtterance('양파')?.doublePar).toBe(true);
  });
});

describe('resolveStrokes', () => {
  it('converts relative results using par', () => {
    expect(resolveStrokes({ hole: null, strokes: null, toPar: -1, doublePar: false, putts: null }, 4)).toBe(3);
    expect(resolveStrokes({ hole: null, strokes: null, toPar: null, doublePar: true, putts: null }, 5)).toBe(10);
    expect(resolveStrokes({ hole: null, strokes: 6, toPar: 1, doublePar: false, putts: null }, 4)).toBe(6);
  });
});

describe('parseScoreUtterance (recognizer variants)', () => {
  it.each([
    ['Hole 7 bogie two putts', { hole: 7, toPar: 1, putts: 2 }],
    ['whole 7 bogey', { hole: 7, toPar: 1 }],
    ['birdy on 3', { hole: 3, toPar: -1, strokes: null }],
    ['Hole 4 double bogie', { hole: 4, toPar: 2 }],
    ['Hole 12, Parr, 2 putts', { hole: 12, toPar: 0, putts: 2 }],
    ['I made a five on 6 with 2 putts', { hole: 6, strokes: 5, putts: 2 }],
    ['three putt bogey on 14', { hole: 14, toPar: 1, putts: 3 }],
    ['Hole ten 6', { hole: 10, strokes: 6 }],
    // Heard in simulator testing for "Hole one par, two putts":
    ['Or one part two pets', { hole: 1, toPar: 0, putts: 2, strokes: null }],
    ['hold 3 boogie 2 puts', { hole: 3, toPar: 1, putts: 2 }],
    ['All one part two parts', { hole: 1, toPar: 0, putts: 2 }],
    ['one', null],
  ])('%s', (text, expected) => {
    if (expected === null) expect(parseScoreUtterance(text)?.strokes ?? null).toBeNull();
    else expect(parseScoreUtterance(text)).toMatchObject(expected);
  });

  it.each([
    ['칠번 홀 보기', { hole: 7, toPar: 1 }],
    ['십이번 홀 파', { hole: 12, toPar: 0 }],
    ['십팔 번 홀 보기', { hole: 18, toPar: 1 }],
    ['2번 홀 다섯 개', { hole: 2, strokes: 5 }],
    ['구번홀 여섯 타 투 퍼트', { hole: 9, strokes: 6, putts: 2 }],
    ['9번홀 파 세이브 투 퍼트', { hole: 9, toPar: 0, putts: 2 }],
    ['이번 홀 보기', { hole: null, toPar: 1 }],
    // Heard in simulator testing for "5번 홀 파 투 퍼트":
    ['오 번홀 파투 putt', { hole: 5, toPar: 0, putts: 2 }],
  ])('%s', (text, expected) => {
    expect(parseScoreUtterance(text)).toMatchObject(expected);
  });
});
