import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { prefs, PREF_KEYS } from '@/lib/prefs';

import en from './locales/en.json';
import ko from './locales/ko.json';

// v1 shipped 11 languages (en ko zh ja id fr de es it vi th). Port the rest from the v1 repo's
// translations_complete.ts into locales/<code>.json and register them here.
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const supported = LANGUAGES.map((l) => l.code) as string[];

function initialLanguage(): string {
  const saved = prefs.get(PREF_KEYS.language);
  if (saved && supported.includes(saved)) return saved;
  const device = getLocales()[0]?.languageCode ?? 'en';
  return supported.includes(device) ? device : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export function setLanguage(code: string): void {
  if (!supported.includes(code)) return;
  prefs.set(PREF_KEYS.language, code);
  void i18n.changeLanguage(code);
}

/** Speech recognizer locale for the current UI language. */
export function speechLocale(): string {
  return i18n.language === 'ko' ? 'ko-KR' : 'en-US';
}

export default i18n;
