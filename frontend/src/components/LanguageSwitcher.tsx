import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/i18n";

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) || SUPPORTED_LANGUAGES[0];

  if (compact) {
    return (
      <button
        onClick={() => {
          const next = SUPPORTED_LANGUAGES.find((l) => l.code !== i18n.language) || SUPPORTED_LANGUAGES[0];
          i18n.changeLanguage(next.code);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-on-surface-variant hover:bg-surface-container transition-colors"
        title={`Switch to ${SUPPORTED_LANGUAGES.find((l) => l.code !== i18n.language)?.label}`}
      >
        <span>{current.flag}</span>
        <span className="uppercase font-medium">{current.code}</span>
      </button>
    );
  }

  return (
    <select
      value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      className="bg-surface-container-high/50 border-0 rounded-lg px-2.5 py-1.5 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.flag} {lang.label}
        </option>
      ))}
    </select>
  );
}
