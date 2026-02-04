import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import SelectOrg from './pages/SelectOrg'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Beneficiaries from './pages/Beneficiaries'
import Disbursements from './pages/Disbursements'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Team from './pages/Team'
import { AuthRequired, OrgRequired } from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      
      {/* Protected routes - require authentication */}
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
      
      {/* Org routes - require authentication and org membership */}
      <Route
        path="/org/:orgId/dashboard"
        element={
          <OrgRequired>
            <Dashboard />
          </OrgRequired>
        }
      />
      <Route
        path="/org/:orgId/beneficiaries"
        element={
          <OrgRequired>
            <Beneficiaries />
          </OrgRequired>
        }
      />
      <Route
        path="/org/:orgId/disbursements"
        element={
          <OrgRequired>
            <Disbursements />
          </OrgRequired>
        }
      />
      <Route
        path="/org/:orgId/reports"
        element={
          <OrgRequired>
            <Reports />
          </OrgRequired>
        }
      />
      <Route
        path="/org/:orgId/team"
        element={
          <OrgRequired>
            <Team />
          </OrgRequired>
        }
      />
      <Route
        path="/org/:orgId/settings"
        element={
          <OrgRequired>
            <Settings />
          </OrgRequired>
        }
      />
    </Routes>
  )
}

export default App
