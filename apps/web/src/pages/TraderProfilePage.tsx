import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { apiFetch } from '../lib/api'
import type { TraderProfilePublic, Conversation } from '../types/traderNetwork'

export function TraderProfilePage() {
  const { userId = '' } = useParams()
  const navigate = useNavigate()
  const [trader, setTrader] = useState<TraderProfilePublic | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    apiFetch<TraderProfilePublic>(`/traders/${userId}`)
      .then(setTrader)
      .catch((e: Error) => setError(e.message))
  }, [userId])

  async function startConversation() {
    setStarting(true)
    try {
      const convo = await apiFetch<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ other_user_id: userId }),
      })
      navigate(`/messages/${convo.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start conversation')
    } finally {
      setStarting(false)
    }
  }

  if (error) {
    return (
      <Layout>
        <p className="text-danger">{error}</p>
      </Layout>
    )
  }

  if (!trader) {
    return (
      <Layout>
        <p className="text-gray-400">Loading...</p>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="bg-card border border-border rounded p-6 mb-6">
        <div className="flex items-start gap-4">
          {trader.profile?.steam_avatar && (
            <img src={trader.profile.steam_avatar} alt="" className="w-20 h-20 rounded" />
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{trader.display_name}</h1>
            {trader.profile?.steam_persona && (
              <p className="text-sm text-gray-400">Steam: {trader.profile.steam_persona}</p>
            )}
            <p className="text-sm text-gray-400 mt-1">
              {trader.total_trades} trade{trader.total_trades === 1 ? '' : 's'}
              {trader.average_rating !== null && ` · ${trader.average_rating.toFixed(2)}/5 rating`}
            </p>
            <p className={`text-sm mt-1 ${trader.accepting_trades ? 'text-accent' : 'text-gray-500'}`}>
              {trader.accepting_trades ? 'Currently accepting trades' : 'Not currently accepting trades'}
            </p>
          </div>
          <button
            onClick={startConversation}
            disabled={starting}
            className="bg-accent text-black font-semibold rounded px-4 py-2 disabled:opacity-50"
          >
            {starting ? 'Opening...' : 'Message'}
          </button>
        </div>

        {trader.bio && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold mb-1">About</h3>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{trader.bio}</p>
          </div>
        )}

        {trader.trade_preferences && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold mb-1">Trade preferences</h3>
            <p className="text-sm text-gray-300">{trader.trade_preferences}</p>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded p-4 text-xs text-gray-400">
        SkinPeer does not hold or escrow CS2 items. SkinPeer does not run Steam trade bots and is not affiliated
        with Valve or Steam. Always verify items, floats, and stickers inside Steam before clicking Accept.
      </div>
    </Layout>
  )
}
