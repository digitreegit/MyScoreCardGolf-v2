// Settings → Score mode: write the card in strokes (4, 5, 6) or over/under par (0, +1, +2).
import type { EntryMode } from '@/domain/types';

import { prefs, PREF_KEYS } from './prefs';

export function getScoreMode(): EntryMode {
  return prefs.get(PREF_KEYS.scoreMode) === 'par' ? 'par' : 'stroke';
}

export function setScoreMode(mode: EntryMode): void {
  prefs.set(PREF_KEYS.scoreMode, mode);
}
