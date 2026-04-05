import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// English
import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enDashboard from "./locales/en/dashboard.json";
import enExpense from "./locales/en/expense.json";
import enGroup from "./locales/en/group.json";
import enReports from "./locales/en/reports.json";
import enProfile from "./locales/en/profile.json";
import enLanding from "./locales/en/landing.json";

// Vietnamese
import viCommon from "./locales/vi/common.json";
import viAuth from "./locales/vi/auth.json";
import viDashboard from "./locales/vi/dashboard.json";
import viExpense from "./locales/vi/expense.json";
import viGroup from "./locales/vi/group.json";
import viReports from "./locales/vi/reports.json";
import viProfile from "./locales/vi/profile.json";
import viLanding from "./locales/vi/landing.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        expense: enExpense,
        group: enGroup,
        reports: enReports,
        profile: enProfile,
        landing: enLanding,
      },
      vi: {
        common: viCommon,
        auth: viAuth,
        dashboard: viDashboard,
        expense: viExpense,
        group: viGroup,
        reports: viReports,
        profile: viProfile,
        landing: viLanding,
      },
    },
    defaultNS: "common",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "chia_language",
    },
  });

export default i18n;
