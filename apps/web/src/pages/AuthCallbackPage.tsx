import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const token = params.get('token')
    const type = params.get('type')

    if (!token || type !== 'magiclink') {
      navigate('/login?error=missing_token', { replace: true })
      return
    }

    supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
      .then(async ({ error }) => {
        if (!error) {
          navigate('/dashboard', { replace: true })
          return
        }
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          navigate('/dashboard', { replace: true })
        } else {
          navigate('/login?error=invalid_token', { replace: true })
        }
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', background: '#0d0f14', color: '#fff',
      fontFamily: 'Inter, sans-serif',
    }}>
      <p>Signing you in via Steam...</p>
    </div>
  )
}
