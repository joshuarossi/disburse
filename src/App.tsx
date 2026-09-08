import { lazy, Suspense } from "react";
import { PageLoading } from "./components/PageLoading";
import { ErrorBoundary } from "./components/ErrorBoundary";
import NotFound from "./pages/NotFound";
import { Routes, Route, Outlet } from "react-router-dom";
import Landing from "./pages/Landing";
import { AppLayout } from "./components/layout/AppLayout";
const Treasury = lazy(() => import("./pages/Treasury"));
const Login = lazy(() => import("./pages/Login"));
const WalletRoutes = lazy(() => import('./providers/WalletRoutes'));
const Docs = lazy(() => import("./pages/Docs"));
const About = lazy(() => import("./pages/About"));
const Blog = lazy(() => import("./pages/Blog"));
const Contact = lazy(() => import("./pages/Contact"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const SelectOrg = lazy(() => import("./pages/SelectOrg"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const PaymentBatches = lazy(() => import("./pages/PaymentBatches"));
const Receivables = lazy(() => import("./pages/Receivables"));
const CustomerInvoice = lazy(() => import("./pages/CustomerInvoice"));
const RecipientDetails = lazy(() => import("./pages/RecipientDetails"));
const AcceptInvitation = lazy(() => import("./pages/AcceptInvitation"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Beneficiaries = lazy(() => import("./pages/Beneficiaries"));
const Disbursements = lazy(() => import("./pages/Disbursements"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Team = lazy(() => import("./pages/Team"));
const LicenseAdmin = lazy(() => import("./pages/LicenseAdmin"));
import { AuthRequired, OrgRequired } from "./components/ProtectedRoute";
import { ScrollToHash } from "./components/ScrollToHash";
import { ApplicationLanguage } from "./providers/ApplicationLanguage";

function App() {
  return (
    <>
      <ScrollToHash />
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/pay/:token" element={<ApplicationLanguage><CustomerInvoice /></ApplicationLanguage>} />
            <Route path="/recipient-details" element={<ApplicationLanguage><RecipientDetails /></ApplicationLanguage>} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/about" element={<About />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />

            {/* Protected routes - require authentication */}
            <Route element={<ApplicationLanguage><WalletRoutes /></ApplicationLanguage>}>
            <Route path="/invite" element={<AcceptInvitation />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin/licenses" element={<AuthRequired><LicenseAdmin /></AuthRequired>} />
            <Route
              path="/select-org"
              element={
                <AuthRequired>
                  <SelectOrg />
                </AuthRequired>
              }
            />
            <Route
              path="/onboarding"
              element={
                <AuthRequired>
                  <Onboarding />
                </AuthRequired>
              }
            />

            <Route
              path="/org/:orgId"
              element={
                <OrgRequired>
                  <AppLayout>
                    <Suspense fallback={<PageLoading />}>
                      <Outlet />
                    </Suspense>
                  </AppLayout>
                </OrgRequired>
              }
            >
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="beneficiaries" element={<Beneficiaries />} />
              <Route path="payments" element={<PaymentBatches />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="receivables" element={<Receivables />} />
              <Route path="disbursements" element={<Disbursements />} />
              <Route path="treasury" element={<Treasury />} />
              <Route path="reports" element={<Reports />} />
              <Route path="team" element={<Team />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

export default App;
