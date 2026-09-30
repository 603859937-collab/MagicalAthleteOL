import { useTranslation } from "react-i18next";

import { LOCALE_LABELS, SUPPORTED_LOCALES, setLocale, type Locale } from "../i18n";

const SHORT_LABELS: Record<Locale, string> = { en: "EN", "zh-CN": "中文" };

/** Locale choice is a stored preference, so it survives a reload and a reconnect. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  return <div className={`language-switcher ${compact ? "compact" : ""}`} role="group" aria-label={t("language.label")}>
    {SUPPORTED_LOCALES.map((locale) => <button key={locale} type="button"
      className={i18n.language === locale ? "active" : ""}
      aria-pressed={i18n.language === locale}
      aria-label={t("language.switchTo", { language: LOCALE_LABELS[locale] })}
      onClick={() => { void setLocale(locale); }}>
      {compact ? SHORT_LABELS[locale] : LOCALE_LABELS[locale]}
    </button>)}
  </div>;
}
