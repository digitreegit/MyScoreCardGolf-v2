// Small synchronous key/value preferences (native: expo-sqlite kv-store; web: see prefs.web.ts).
import Storage from 'expo-sqlite/kv-store';

export const prefs = {
  get(key: string): string | null {
    return Storage.getItemSync(key);
  },
  set(key: string, value: string | null): void {
    if (value == null) Storage.removeItemSync(key);
    else Storage.setItemSync(key, value);
  },
};

export const PREF_KEYS = {
  language: 'pref:language',
  guestChosen: 'pref:guestChosen',
  distanceUnit: 'pref:distanceUnit',
} as const;
