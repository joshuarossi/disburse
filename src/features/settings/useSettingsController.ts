import { userErrorMessage } from '@/lib/userErrors';
import { useBillingCheckout } from "./useBillingCheckout";
import { billingAccess } from "../../../shared/billing";
import { useEffect, useState } from "react";
import { getSessionToken } from "@/lib/session";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { CHAINS_LIST } from "@/lib/chains";
import {
  DEFAULT_RELAY_FEE_MODE,
  DEFAULT_RELAY_FEE_TOKEN_SYMBOL,
  resolveRelaySettings,
  type RelayFeeMode,
  type RelayFeeTokenSymbol,
} from "@/lib/relayConfig";
export function useSettingsController() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();

  // Organization state
  const [orgName, setOrgName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [orgNameError, setOrgNameError] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Safe state
  const [safeAddress, setSafeAddress] = useState("");
  const [accountName, setAccountName] = useState("");
  const [selectedChainId, setSelectedChainId] = useState<number>(11155111);
  const [isLinking, setIsLinking] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Relay fee settings
  const [relayFeeTokenSymbol, setRelayFeeTokenSymbol] =
    useState<RelayFeeTokenSymbol>(DEFAULT_RELAY_FEE_TOKEN_SYMBOL);
  const [relayFeeMode, setRelayFeeMode] = useState<RelayFeeMode>(
    DEFAULT_RELAY_FEE_MODE,
  );
  const [relaySettingsLoaded, setRelaySettingsLoaded] = useState(false);
  const [savingRelaySettings, setSavingRelaySettings] = useState(false);
  const [relaySettingsError, setRelaySettingsError] = useState<string | null>(
    null,
  );

  const [settingsError, setSettingsError] = useState("");

  const org = useQuery(
    api.orgs.get,
    orgId && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );

  const safes = useQuery(
    api.safes.getForOrg,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );
  const depositAddress =
    safes && safes.length > 0 ? safes[0].safeAddress : undefined;
  const availableChainsToLink = CHAINS_LIST;

  const members = useQuery(
    api.orgs.listMembers,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );

  const billingRecord = useQuery(
    api.billing.get,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );

  const [billingNow, setBillingNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setBillingNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const billing = billingRecord
    ? { ...billingRecord, ...billingAccess(billingRecord, billingNow) }
    : billingRecord;

  // Get current user's role
  const currentUserRole = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase(),
  )?.role;
  const isAdmin = currentUserRole === "admin";
  const checkout = useBillingCheckout({ orgId, address, isAdmin, billing });

  const updateOrgName = useMutation(api.orgs.updateName);
  const linkSafe = useAction(api.safes.link);
  const unlinkSafe = useMutation(api.safes.unlink);
  const updateScreeningEnforcement = useMutation(
    api.screeningMutations.updateScreeningEnforcement,
  );
  const updateRelaySettings = useMutation(api.orgs.updateRelaySettings);

  const screeningEnforcement = useQuery(
    api.screeningQueries.getScreeningEnforcement,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );
  const [savingEnforcement, setSavingEnforcement] = useState(false);

  useEffect(() => {
    if (org?.name && !isEditingName) setOrgName(org.name);
  }, [org?.name, isEditingName]);

  const resolvedRelaySettings = resolveRelaySettings(org ?? undefined);
  useEffect(() => {
    if (org && !relaySettingsLoaded) {
      setRelayFeeTokenSymbol(resolvedRelaySettings.relayFeeTokenSymbol);
      setRelayFeeMode(resolvedRelaySettings.relayFeeMode);
      setRelaySettingsLoaded(true);
    }
  }, [
    org,
    relaySettingsLoaded,
    resolvedRelaySettings.relayFeeTokenSymbol,
    resolvedRelaySettings.relayFeeMode,
  ]);

  const handleSaveOrgName = async () => {
    if (!orgId || !address || !orgName.trim()) return;

    setOrgNameError("");
    setSavingName(true);
    try {
      await updateOrgName({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        name: orgName.trim(),
      });
      setIsEditingName(false);
    } catch (error) {
      setOrgNameError(
        userErrorMessage(error, "Could not save the workspace name"),
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveRelaySettings = async () => {
    if (!orgId || !address) return;
    setSavingRelaySettings(true);
    setRelaySettingsError(null);
    try {
      await updateRelaySettings({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        relayFeeTokenSymbol,
        relayFeeMode,
      });
    } catch (error) {
      console.error("Failed to update relay settings:", error);
      setRelaySettingsError(
        userErrorMessage(error, "Failed to update relay settings"),
      );
    } finally {
      setSavingRelaySettings(false);
    }
  };

  const handleLinkSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !safeAddress.trim()) return;

    setIsValidating(true);
    setLinkingError(null);

    try {
      await linkSafe({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        safeAddress: safeAddress.trim(),
        chainId: selectedChainId,
        name: accountName.trim() || undefined,
      });
      setSafeAddress("");
      setAccountName("");
      setIsLinking(false);
    } catch (error) {
      console.error("Failed to link safe:", error);
      setLinkingError(
        userErrorMessage(error, "Failed to link Safe"),
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleUnlinkSafe = async (safeId: Id<"safes">) => {
    if (!address) return;
    if (!confirm(t("settings.safe.unlinkConfirm"))) return;
    try {
      await unlinkSafe({ safeId, sessionToken: getSessionToken() ?? "" });
    } catch (error) {
      console.error("Failed to unlink safe:", error);
      setLinkingError(
        userErrorMessage(error, "Could not unlink this account"),
      );
    }
  };

  const handleUpdateEnforcement = async (
    enforcement: "block" | "warn" | "off",
  ) => {
    if (!orgId || !address) return;
    setSavingEnforcement(true);
    try {
      await updateScreeningEnforcement({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        enforcement,
      });
    } catch (error) {
      setSettingsError(
        userErrorMessage(error, "Could not save screening settings"),
      );
    } finally {
      setSavingEnforcement(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setSettingsError(
        "Could not copy. Select and copy the displayed address.",
      );
    }
  };

  const relaySettingsChanged =
    relayFeeTokenSymbol !== resolvedRelaySettings.relayFeeTokenSymbol ||
    relayFeeMode !== resolvedRelaySettings.relayFeeMode;

  return {
    ...checkout,
    settingsError,
    setSettingsError,
    orgNameError,
    t,
    orgName,
    setOrgName,
    isEditingName,
    setIsEditingName,
    savingName,
    safeAddress,
    setSafeAddress,
    accountName,
    setAccountName,
    selectedChainId,
    setSelectedChainId,
    isLinking,
    setIsLinking,
    linkingError,
    setLinkingError,
    isValidating,
    relayFeeTokenSymbol,
    setRelayFeeTokenSymbol,
    relayFeeMode,
    setRelayFeeMode,
    savingRelaySettings,
    relaySettingsError,
    safes,
    depositAddress,
    availableChainsToLink,
    billing,
    isAdmin,
    screeningEnforcement,
    savingEnforcement,
    handleSaveOrgName,
    handleSaveRelaySettings,
    handleLinkSafe,
    handleUnlinkSafe,
    handleUpdateEnforcement,
    copyToClipboard,
    relaySettingsChanged,
    SEPOLIA_CHAIN_ID: 11155111,
  };
}
