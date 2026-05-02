import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'

const useAuthMock = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

function renderAt(path: string, ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>LoginPage</div>} />
        <Route path="/dashboard" element={<div>DashboardPage</div>} />
        <Route path="/admin" element={ui as any} />
        <Route path="/private" element={ui as any} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => useAuthMock.mockReset())

  it('shows a loading state while auth is resolving', () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: true })
    renderAt('/private', <ProtectedRoute><div>Inside</div></ProtectedRoute>)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('redirects to /login when user is null', () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: false })
    renderAt('/private', <ProtectedRoute><div>Inside</div></ProtectedRoute>)
    expect(screen.getByText('LoginPage')).toBeInTheDocument()
  })

  it('renders children when user is present and not adminOnly', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u' }, profile: { is_admin: false }, loading: false })
    renderAt('/private', <ProtectedRoute><div>Inside</div></ProtectedRoute>)
    expect(screen.getByText('Inside')).toBeInTheDocument()
  })

  it('redirects non-admin to /dashboard when adminOnly', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u' }, profile: { is_admin: false }, loading: false })
    renderAt('/admin', <ProtectedRoute adminOnly><div>AdminInside</div></ProtectedRoute>)
    expect(screen.getByText('DashboardPage')).toBeInTheDocument()
  })

  it('renders admin children when profile.is_admin is true', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u' }, profile: { is_admin: true }, loading: false })
    renderAt('/admin', <ProtectedRoute adminOnly><div>AdminInside</div></ProtectedRoute>)
    expect(screen.getByText('AdminInside')).toBeInTheDocument()
  })
})
