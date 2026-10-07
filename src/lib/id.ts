import * as Crypto from 'expo-crypto';

/** UUID v4, generated on the device so rounds created offline keep a stable id. */
export function newId(): string {
  return Crypto.randomUUID();
}
