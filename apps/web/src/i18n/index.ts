import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enApp from "./locales/en/app.json";
import enAthletes from "./locales/en/athletes.json";
import enRace from "./locales/en/race.json";
import zhApp from "./locales/zh-CN/app.json";
import zhAthletes from "./locales/zh-CN/athletes.json";
import zhRace from "./locales/zh-CN/race.json";

// English is the source language: every key is authored in en first and
// zh-CN carries the translation. Keep the two files structurally identical.
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: Locale = "en";
const STORAGE_KEY = "magicalAthlete.locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Matches a BCP-47 tag such as `zh-Hans-CN` or `zh-TW` onto a supported locale. */
export function matchLocale(tag: string): Locale | null {
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("en")) return "en";
  return null;
}

/** The `?lang=` query wins so a translation platform can deep-link a locale. */
export function detectLocale(): Locale {
  // Tests and any non-DOM consumer fall back to the source language.
  if (typeof window === "undefined") return FALLBACK_LOCALE;

  const fromQuery = new URLSearchParams(window.location.search).get("lang");
  if (isLocale(fromQuery)) return fromQuery;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;

  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

export function applyDocumentLanguage(locale: string) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export async function setLocale(locale: Locale) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, locale);
  await i18n.changeLanguage(locale);
}

void i18n.use(initReactI18next).init({
  lng: detectLocale(),
  fallbackLng: FALLBACK_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  defaultNS: "app",
  ns: ["app", "race", "athletes"],
  resources: {
    en: { app: enApp, race: enRace, athletes: enAthletes },
    "zh-CN": { app: zhApp, race: zhRace, athletes: zhAthletes },
  },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  // Translation keys double as readable identifiers during development.
  saveMissing: false,
});

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

export default i18n;
