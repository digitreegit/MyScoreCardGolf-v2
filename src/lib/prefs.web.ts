// Web preferences in the browser's localStorage. Same exports as prefs.ts.
const hasStorage = () => typeof window !== 'undefined' && !!window.localStorage;

export const prefs = {
  get(key: string): string | null {
    return hasStorage() ? window.localStorage.getItem(key) : null;
  },
  set(key: string, value: string | null): void {
    if (!hasStorage()) return;
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  },
};

export const PREF_KEYS = {
  language: 'pref:language',
  guestChosen: 'pref:guestChosen',
  distanceUnit: 'pref:distanceUnit',
} as const;
