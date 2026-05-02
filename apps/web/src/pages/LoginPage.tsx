import { useSearchParams } from 'react-router-dom'

const ERROR_MESSAGES: Record<string, string> = {
  steam_failed:         'Steam authentication failed. Please try again.',
  user_creation_failed: 'Could not create your account. Contact support.',
  session_failed:       'Session creation failed. Please try again.',
  missing_token:        'Authentication token was missing. Please try again.',
  invalid_token:        'Authentication token was invalid or expired.',
  unknown:              'Something went wrong. Please try again.',
}

const STEAM_LOGIN_URL = `${import.meta.env.VITE_API_URL}/api/auth/steam`

export function LoginPage() {
  const [params] = useSearchParams()
  const error = params.get('error')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', background: '#0d0f14',
      color: '#fff', fontFamily: 'Inter, sans-serif', gap: 24,
    }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>SkinPeer</h1>
      <p style={{ color: '#9ca3af', margin: 0 }}>CS2 Skin Trade Verification Platform</p>

      {error && (
        <div style={{
          background: '#1f1a1a', border: '1px solid #ef4444', color: '#fca5a5',
          padding: '12px 20px', borderRadius: 8, maxWidth: 400, textAlign: 'center',
        }}>
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown}
        </div>
      )}

      <a
        href={STEAM_LOGIN_URL}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#1b2838', border: '1px solid #4c6b8a',
          color: '#fff', padding: '12px 24px', borderRadius: 4,
          textDecoration: 'none', fontWeight: 600, fontSize: 16,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.38l3.01-6.24A3.5 3.5 0 0 1 12 10.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5 3.5 3.5 0 0 1-3.1-1.87L3.3 18.5A12 12 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z"/>
        </svg>
        Sign in through Steam
      </a>

      <p style={{ color: '#6b7280', fontSize: 13, maxWidth: 360, textAlign: 'center', margin: 0 }}>
        Your Steam inventory must be set to{' '}
        <strong style={{ color: '#9ca3af' }}>public</strong> to add items to trades.
      </p>
    </div>
  )
}
