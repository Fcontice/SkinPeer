import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { FindTradersPage } from './pages/FindTradersPage'
import { TraderProfilePage } from './pages/TraderProfilePage'
import { EditProfilePage } from './pages/EditProfilePage'
import { MessagesPage } from './pages/MessagesPage'
import { ProposeTradePage } from './pages/ProposeTradePage'
import { TradeProposalPage } from './pages/TradeProposalPage'
import { MyTradesPage } from './pages/MyTradesPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboardPage /></ProtectedRoute>} />

        <Route path="/dashboard" element={<ProtectedRoute><MyTradesPage /></ProtectedRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
        <Route path="/profile/edit" element={<ProtectedRoute><EditProfilePage /></ProtectedRoute>} />
        <Route path="/traders" element={<ProtectedRoute><FindTradersPage /></ProtectedRoute>} />
        <Route path="/traders/:userId" element={<ProtectedRoute><TraderProfilePage /></ProtectedRoute>} />
        <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
        <Route path="/messages/:id" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
        <Route path="/proposals" element={<ProtectedRoute><MyTradesPage /></ProtectedRoute>} />
        <Route path="/messages/:conversationId/propose" element={<ProtectedRoute><ProposeTradePage /></ProtectedRoute>} />
        <Route path="/proposals/:id" element={<ProtectedRoute><TradeProposalPage /></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  )
}
