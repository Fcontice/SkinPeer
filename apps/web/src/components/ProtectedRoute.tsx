import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface Props {
  children: React.ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly }: Props) {
  const { user, profile, loading } = useAuth()

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center text-gray-400">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !profile?.is_admin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
