import { Link, useNavigate } from 'react-router-dom'
import { TrustBar } from './TrustBar'
import { useAuth } from '../context/AuthContext'
import { usePendingOffersCount } from '../hooks/usePendingOffersCount'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const pending = usePendingOffersCount()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <TrustBar />
      <nav className="border-b border-border px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-accent font-bold text-lg">SkinPeer</Link>
        {user && (
          <div className="flex items-center gap-4">
            <Link to="/traders" className="text-sm text-gray-300 hover:text-white">Find traders</Link>
            <Link to="/messages" className="text-sm text-gray-300 hover:text-white">Messages</Link>
            <Link to="/proposals" className="text-sm text-gray-300 hover:text-white relative">
              My trades
              {pending > 0 && (
                <span className="absolute -top-1 -right-3 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-warning text-[10px] text-black font-semibold">
                  {pending}
                </span>
              )}
            </Link>
            <Link to="/profile/edit" className="text-sm text-gray-300 hover:text-white">Profile</Link>
            {profile?.is_admin && (
              <Link to="/admin" className="text-sm text-warning">Admin</Link>
            )}
            <span className="text-sm text-gray-400">{profile?.steam_persona ?? profile?.username ?? user.email}</span>
            <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-white">Sign out</button>
          </div>
        )}
      </nav>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
