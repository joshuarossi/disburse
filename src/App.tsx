import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import SelectOrg from './pages/SelectOrg'
import Dashboard from './pages/Dashboard'
import Beneficiaries from './pages/Beneficiaries'
import Disbursements from './pages/Disbursements'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
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
        path="/org/:orgId/billing"
        element={
          <OrgRequired>
            <Billing />
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
