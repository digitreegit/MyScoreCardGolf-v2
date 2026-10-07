// One-time import of v1 data on first launch after updating from the store.
// v1 kept everything in AsyncStorage; v2 uses the same bundle IDs, so that storage is still on the device.
// The v1 keys are left in place (not deleted) as a safety net.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { nowIso } from '@/domain/types';
import { convertV1Rounds, V1_ROUNDS_KEY, V1_SETTINGS_KEY, type V1Settings } from '@/domain/v1Convert';
import { newId } from '@/lib/id';

import { emitDataChanged } from './events';
import * as db from './local/db';

const DONE_KEY = 'v1:imported';

export interface V1ImportResult {
  imported: number;
  language: string | null;
}

export async function importV1DataOnce(userId: string | null): Promise<V1ImportResult | null> {
  if (await db.kvGet(DONE_KEY)) return null;

  const [roundsRaw, settingsRaw] = await Promise.all([
    AsyncStorage.getItem(V1_ROUNDS_KEY),
    AsyncStorage.getItem(V1_SETTINGS_KEY),
  ]);
  const items = convertV1Rounds(roundsRaw, { userId, newId, now: nowIso() });
  if (items.length) {
    await db.writeRoundWithHoles(items);
    emitDataChanged();
  }

  let language: string | null = null;
  try {
    language = settingsRaw ? ((JSON.parse(settingsRaw) as V1Settings).lang ?? null) : null;
  } catch {
    language = null;
  }

  await db.kvSet(DONE_KEY, nowIso());
  return { imported: items.length, language };
}
