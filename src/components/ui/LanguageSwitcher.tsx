import { useState } from "react";
import { useSessionToken } from "@/lib/session";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Languages, Check } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";
import { tx } from "@/lib/workspaceI18n";

const languages = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
] as const;

type SwitcherProps = {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  compactOnSmallScreens?: boolean;
  inline?: boolean;
};

export function LanguageSwitcher({
  variant = "ghost",
  size = "sm",
  compactOnSmallScreens = false,
  inline = false,
}: SwitcherProps) {
  const { i18n } = useTranslation();
  const sessionToken = useSessionToken();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const updatePreferredLanguage = useMutation(
    api.users.updatePreferredLanguage,
  );

  const currentLanguage =
    languages.find((lang) => lang.code === i18n.resolvedLanguage) ||
    languages[0];

  const handleLanguageChange = async (langCode: string) => {
    if (saving || !languages.some((language) => language.code === langCode))
      return;
    await i18n.changeLanguage(langCode);
    setIsOpen(false);
    setSaveFailed(false);

    if (sessionToken) {
      setSaving(true);
      try {
        await updatePreferredLanguage({
          sessionToken,
          preferredLanguage: langCode as "en" | "es" | "pt-BR",
        });
      } catch {
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }
    }
  };

  const failure = saveFailed && (
    <p
      role="alert"
      className={cn(
        "mt-2 max-w-xs text-sm text-[var(--color-text-primary)]",
        !inline &&
          "absolute right-0 top-full z-[60] w-64 rounded-lg border border-white/10 bg-[var(--color-bg-primary)] p-3 shadow-xl",
        !inline &&
          compactOnSmallScreens &&
          "fixed inset-x-4 top-16 w-auto max-w-none md:absolute md:left-auto md:right-0 md:top-full md:w-64",
      )}
    >
      {tx(
        "Language changed on this device. Your account preference could not be saved.",
      )}{" "}
      <button
        type="button"
        className="underline"
        disabled={saving}
        onClick={() => void handleLanguageChange(currentLanguage.code)}
      >
        {tx("Retry")}
      </button>
    </p>
  );

  if (inline)
    return (
      <div className="min-w-0 max-w-full">
        <select
          aria-label={tx("Language")}
          className="finance-field max-w-full"
          value={currentLanguage.code}
          onChange={(event) => void handleLanguageChange(event.target.value)}
          disabled={saving}
        >
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
        {failure}
      </div>
    );

  return (
    <div className="relative">
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(!isOpen)}
        disabled={saving}
        aria-expanded={isOpen}
        className={cn(
          "gap-2 w-full justify-start",
          compactOnSmallScreens &&
            "h-10 w-10 justify-center px-0 md:h-9 md:w-auto md:justify-start md:px-3",
        )}
      >
        <Languages className="h-4 w-4" />
        <span
          className={
            compactOnSmallScreens ? "sr-only md:not-sr-only" : undefined
          }
        >
          {currentLanguage.label}
        </span>
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[46]"
            onClick={() => setIsOpen(false)}
          />
          <div
            className={cn(
              "absolute right-0 top-full mt-2 z-[60] w-48 rounded-lg border border-white/10 bg-navy-900 shadow-xl overflow-hidden",
              compactOnSmallScreens &&
                "fixed inset-x-4 top-16 w-auto md:absolute md:left-auto md:right-0 md:top-full md:w-48",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
                  i18n.resolvedLanguage === lang.code
                    ? "bg-accent-500/10 text-accent-400"
                    : "text-slate-300 hover:bg-navy-800 hover:text-white",
                )}
              >
                <span className="text-lg">{lang.flag}</span>
                <span className="flex-1">{lang.label}</span>
                {i18n.resolvedLanguage === lang.code && (
                  <Check className="h-4 w-4" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {failure}
    </div>
  );
}
