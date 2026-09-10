import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslations from "../locales/en/translation.json";
import esTranslations from "../locales/es/translation.json";
import ptBRTranslations from "../locales/pt-BR/translation.json";
import enWorkspace from "../locales/en/workspace.json";
import esWorkspace from "../locales/es/workspace.json";
import ptWorkspace from "../locales/pt-BR/workspace.json";

const resources = {
  en: {
    translation: enTranslations,
    workspace: enWorkspace,
  },
  es: {
    translation: esTranslations,
    workspace: esWorkspace,
  },
  "pt-BR": {
    translation: ptBRTranslations,
    workspace: ptWorkspace,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "es", "pt-BR"],
    defaultNS: "translation",
    initImmediate: false,
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
      convertDetectedLanguage: (language: string) =>
        language.toLowerCase().startsWith("pt")
          ? "pt-BR"
          : language.toLowerCase().startsWith("es")
            ? "es"
            : "en",
    },
  });

export default i18n;
