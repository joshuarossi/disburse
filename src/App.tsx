import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import SelectOrg from './pages/SelectOrg'
import Dashboard from './pages/Dashboard'
import Beneficiaries from './pages/Beneficiaries'
import Disbursements from './pages/Disbursements'
import Billing from './pages/Billing'
import Settings from './pages/Settings'

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      
      {/* Protected routes */}
      <Route path="/select-org" element={<SelectOrg />} />
      <Route path="/org/:orgId/dashboard" element={<Dashboard />} />
      <Route path="/org/:orgId/beneficiaries" element={<Beneficiaries />} />
      <Route path="/org/:orgId/disbursements" element={<Disbursements />} />
      <Route path="/org/:orgId/billing" element={<Billing />} />
      <Route path="/org/:orgId/settings" element={<Settings />} />
    </Routes>
  )
}

export default App
