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
