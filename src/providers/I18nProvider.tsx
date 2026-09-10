import { ReactNode, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useTranslation } from "react-i18next";
import { useSessionToken } from "@/lib/session";
import "../lib/i18n"; // Initialize i18n

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "en";

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const token = useSessionToken();
  const session = useQuery(
    api.auth.validateSession,
    token ? { token } : "skip",
  );

  useEffect(() => {
    if (session?.preferredLanguage) {
      // Set language from user preference
      i18n.changeLanguage(session.preferredLanguage);
    }
  }, [session?.preferredLanguage, i18n]);

  return <>{children}</>;
}
