import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { apiFetch } from '../lib/api'
import type { TraderProfile } from '../types/traderNetwork'

export function OnboardingPage() {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [tradePreferences, setTradePreferences] = useState('')
  const [acceptingTrades, setAcceptingTrades] = useState(true)
  const [isPublic, setIsPublic] = useState(true)

  useEffect(() => {
    apiFetch<TraderProfile>('/traders/me/profile')
      .then((p) => {
        setDisplayName(p.display_name ?? '')
        setBio(p.bio ?? '')
        setTradePreferences(p.trade_preferences ?? '')
        setAcceptingTrades(p.accepting_trades)
        setIsPublic(p.is_public ?? true)
        setLoaded(true)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await apiFetch<TraderProfile>('/traders/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: displayName,
          bio: bio || null,
          trade_preferences: tradePreferences || null,
          accepting_trades: acceptingTrades,
          is_public: isPublic,
        }),
      })
      navigate('/traders')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded && !error) {
    return (
      <Layout>
        <p className="text-gray-400">Loading...</p>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Set up your trader profile</h1>
        <p className="text-sm text-gray-400 mb-6">
          Other traders see this when you appear in Find Traders. You can update it any time.
        </p>

        {error && <p className="text-danger text-sm mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Display name</label>
            <input
              required
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Bio (optional)</label>
            <textarea
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              className="w-full bg-card border border-border rounded px-3 py-2"
              placeholder="Tell other traders who you are."
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Trade preferences (optional)</label>
            <input
              maxLength={500}
              value={tradePreferences}
              onChange={(e) => setTradePreferences(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-2"
              placeholder="e.g. Knives and gloves only"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="accepting"
              type="checkbox"
              checked={acceptingTrades}
              onChange={(e) => setAcceptingTrades(e.target.checked)}
            />
            <label htmlFor="accepting" className="text-sm">Currently accepting trades</label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="public"
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <label htmlFor="public" className="text-sm">List me in Find Traders</label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-accent text-black font-semibold rounded px-4 py-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save and continue'}
          </button>
        </form>
      </div>
    </Layout>
  )
}
