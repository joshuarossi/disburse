import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Sun, Moon, ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/WorkspacePrimitives";
import { PageLoading } from "@/components/PageLoading";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CompanyLicenseForm } from "@/features/licenses/CompanyLicenseForm";
import {
  CreateLicenseTier,
  SignupProgram,
} from "@/features/licenses/LicenseCatalogForms";
import { fieldClass, LicenseField } from "@/features/licenses/LicenseFields";
import type { LicenseTier } from "../../shared/billing";

export default function LicenseAdmin() {
  const sessionToken = useSessionToken(),
    { theme, toggleTheme } = useTheme();
  const access = useQuery(
    api.licenseAdmin.access,
    sessionToken ? { sessionToken } : "skip",
  );
  return (
    <div className="workspace min-h-screen bg-[var(--ws-bg)] text-[var(--ws-text)]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-8 sm:py-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link
            to="/select-org"
            className="workspace-action-link flex items-center gap-2 text-sm"
          >
            <ArrowLeft size={16} />
            Your workspaces
          </Link>
          <Button
            variant="secondary"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
        <PageHeader
          title="License management"
          eyebrow="Disburse operators"
          description="Manage company access, complimentary tiers, and new signup terms."
        />
        {access === undefined ? (
          <PageLoading />
        ) : !access.allowed ? (
          <section className="workspace-panel p-6">
            <h2 className="font-semibold">Operator access required</h2>
            <p className="workspace-description mt-2">
              This account is not authorized to manage company licenses.
              Workspace administrators manage their own plan in Settings.
            </p>
          </section>
        ) : (
          <ErrorBoundary withinWorkspace>
            <LicenseConsole sessionToken={sessionToken!} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
function LicenseConsole({ sessionToken }: { sessionToken: string }) {
  const [tab, setTab] = useState<"companies" | "tiers" | "signup">("companies");
  const catalog = useQuery(api.licenseAdmin.catalog, { sessionToken });
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <p className="workspace-description mb-5">
        Free access waives the subscription only. Customers pay all network and
        provider fees.
      </p>
      <nav
        aria-label="License management sections"
        className="workspace-tabs mb-6"
      >
        {(
          [
            ["companies", "Companies"],
            ["tiers", "Free tiers"],
            ["signup", "Signup program"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {!catalog ? (
        <PageLoading />
      ) : tab === "companies" ? (
        <CompanyDirectory sessionToken={sessionToken} tiers={catalog.tiers} />
      ) : tab === "tiers" ? (
        <CreateLicenseTier catalog={catalog} sessionToken={sessionToken} />
      ) : (
        <SignupProgram
          key={generation}
          catalog={catalog}
          sessionToken={sessionToken}
          onReload={() => setGeneration((g) => g + 1)}
        />
      )}
    </>
  );
}
function CompanyDirectory({
  sessionToken,
  tiers,
}: {
  sessionToken: string;
  tiers: LicenseTier[];
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [orgId, setOrgId] = useState<Id<"orgs">>(),
    [generation, setGeneration] = useState(0);
  const companies = useQuery(api.licenseAdmin.companies, {
    sessionToken,
    search: filter || undefined,
    paginationOpts: {
      numItems: 20,
      cursor: cursors[cursors.length - 1] ?? null,
    },
  });
  const company = useQuery(
    api.licenseAdmin.company,
    orgId ? { sessionToken, orgId } : "skip",
  );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
      <section className="workspace-panel p-5" aria-label="Companies">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(search.trim());
            setCursors([null]);
          }}
        >
          <LicenseField label="Find a company">
            <input
              className={fieldClass}
              type="search"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Company name"
            />
          </LicenseField>
          <Button type="submit" size="sm" variant="secondary">
            Search companies
          </Button>
        </form>
        {!companies ? (
          <PageLoading />
        ) : (
          <>
            <ul className="space-y-2 mt-5">
              {companies.page.map((org) => (
                <li key={org.id}>
                  <button
                    className={`w-full text-left rounded-lg border p-3 ${orgId === org.id ? "border-[var(--ws-accent)] bg-[var(--ws-surface-hover)]" : "border-[var(--ws-border)]"}`}
                    aria-pressed={orgId === org.id}
                    onClick={() => setOrgId(org.id)}
                  >
                    <span className="block font-medium break-words">
                      {org.name}
                    </span>
                    <span className="block workspace-description !text-xs mt-1 break-all">
                      {org.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!companies.page.length && (
              <p className="workspace-description mt-5">
                No matching companies.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <Button
                size="sm"
                variant="secondary"
                disabled={cursors.length === 1}
                onClick={() => setCursors((list) => list.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={companies.isDone}
                onClick={() =>
                  setCursors((list) => [...list, companies.continueCursor])
                }
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
      {orgId ? (
        company ? (
          <CompanyLicenseForm
            key={`${orgId}-${generation}`}
            company={company}
            tiers={tiers}
            sessionToken={sessionToken}
            onReload={() => setGeneration((g) => g + 1)}
          />
        ) : (
          <PageLoading />
        )
      ) : (
        <div className="workspace-panel p-8">
          <h2 className="font-semibold">Choose a company</h2>
          <p className="workspace-description mt-2">
            Review its current access before extending a trial or granting a
            free tier.
          </p>
        </div>
      )}
    </div>
  );
}
