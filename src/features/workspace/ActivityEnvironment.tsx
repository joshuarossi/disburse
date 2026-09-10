import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { ActivityEnvironment } from "../../../shared/assets";

const ActivityContext = createContext<{
  environment: ActivityEnvironment;
  setEnvironment: (value: ActivityEnvironment) => void;
}>({ environment: "production", setEnvironment: () => {} });

export function ActivityProvider({
  orgId,
  children,
}: {
  orgId: string;
  children: ReactNode;
}) {
  useWorkspaceLanguage();
  const storageKey = `disburse:activity:${orgId}`;
  const [environment, update] = useState<ActivityEnvironment>(() => {
    const saved = sessionStorage.getItem(storageKey);
    return saved === "test" || saved === "unclassified" ? saved : "production";
  });
  const setEnvironment = (value: ActivityEnvironment) => {
    sessionStorage.setItem(storageKey, value);
    update(value);
  };
  return (
    <ActivityContext.Provider value={{ environment, setEnvironment }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivityEnvironment() {
  return useContext(ActivityContext);
}

export function ActivitySelector() {
  useWorkspaceLanguage();
  const { environment, setEnvironment } = useActivityEnvironment();
  return (
    <label className="workspace-activity-selector">
      <span className="sr-only">{tx("Activity environment")}</span>
      <select
        aria-label={tx("Activity environment")}
        value={environment}
        onChange={(e) => setEnvironment(e.target.value as ActivityEnvironment)}
      >
        <option value="production">{tx("Business activity")}</option>
        <option value="test">{tx("Test activity")}</option>
        <option value="unclassified">{tx("Unclassified records")}</option>
      </select>
    </label>
  );
}
