import type { ReactNode } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import translations from "../locales/en/translation.json";

// The v2 finance workspace ships in English. Public pages keep the visitor's
// language preference. A separate instance avoids changing that saved choice,
// remounting financial forms or mixing old translations with the new workflows.
const applicationLanguage = createInstance();
void applicationLanguage.init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en"],
  resources: { en: { translation: translations } },
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export function ApplicationLanguage({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={applicationLanguage}>
      <div lang="en" className="contents">
        {children}
      </div>
    </I18nextProvider>
  );
}
