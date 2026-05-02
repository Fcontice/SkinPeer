import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ScamWarningBanner } from '../components/ScamWarningBanner'
import { VerificationCode } from '../components/VerificationCode'
import { AgreedItemsPanel } from '../components/AgreedItemsPanel'
import { SendTradeOnSteamButton } from '../components/SendTradeOnSteamButton'
import { PriceProvider } from '../context/PriceContext'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  type AiSafetyReview,
  type TradeItem,
  type TradeProposal,
} from '../types/traderNetwork'
import type { InventoryItem } from '../../../../packages/shared/src/schemas'

interface ProposalView {
  proposal: TradeProposal
  items: { creator: TradeItem[]; recipient: TradeItem[] }
  ai_review: AiSafetyReview | null
  steam_trade_urls?: { creator: string | null; recipient: string | null }
  display_names?: { creator: string; recipient: string }
  viewer_has_steam_webapi_token?: boolean
}

interface InventoryResponse { items: InventoryItem[]; cached: boolean }

const RISK_COLOR: Record<AiSafetyReview['risk_level'], string> = {
  low: 'text-accent',
  medium: 'text-warning',
  high: 'text-orange-400',
  critical: 'text-danger',
}

const STATUS_LABEL: Record<TradeProposal['status'], string> = {
  draft: 'In review',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
  in_review: 'In review',
}

export function TradeProposalPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [view, setView] = useState<ProposalView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiRunning, setAiRunning] = useState(false)
  const [marking, setMarking] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSent, setReviewSent] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  async function refresh() {
    try {
      const data = await apiFetch<ProposalView>(`/proposals/${id}`)
      setView(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Realtime: refresh when the proposal row changes (mark flags + status flips
  // both arrive on this channel).
  useEffect(() => {
    if (!id) return
    const chan = supabase
      .channel(`proposal:${id}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'trade_proposals', filter: `id=eq.${id}` },
          () => void refresh())
      .subscribe()
    return () => { void supabase.removeChannel(chan) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadInventory() {
    try {
      const data = await apiFetch<InventoryResponse>('/me/inventory')
      setInventory(data.items.filter((i) => i.tradable))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Inventory load failed')
    }
  }

  async function addItem(item: InventoryItem) {
    try {
      await apiFetch(`/proposals/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          name: item.name,
          wear: item.wear,
          rarity: item.rarity,
          image_url: item.icon_url,
          steam_asset_id: item.asset_id,
        }),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add item failed')
    }
  }

  async function removeItem(itemId: string) {
    try {
      await apiFetch(`/proposals/${id}/items/${itemId}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  async function markCompleted() {
    setMarking(true)
    try {
      await apiFetch(`/proposals/${id}/mark-completed`, { method: 'POST' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mark completed failed')
    } finally {
      setMarking(false)
    }
  }

  async function resetMarkCompleted() {
    if (!confirm('Reset both mark-completed flags? Both users will need to mark again.')) return
    try {
      await apiFetch(`/proposals/${id}/mark-completed/reset`, { method: 'POST' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  async function cancel() {
    if (!confirm('Cancel this proposal?')) return
    try {
      await apiFetch(`/proposals/${id}/cancel`, { method: 'POST' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    }
  }

  async function runAi() {
    setAiRunning(true)
    try {
      await apiFetch(`/proposals/${id}/ai-review`, { method: 'POST' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI review failed')
    } finally {
      setAiRunning(false)
    }
  }

  async function submitReview() {
    setReviewError(null)
    try {
      await apiFetch(`/proposals/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment || null }),
      })
      setReviewSent(true)
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Review failed')
    }
  }

  if (error) return <Layout><p className="text-danger">{error}</p></Layout>
  if (!view || !user) return <Layout><p className="text-gray-400">Loading...</p></Layout>

  const { proposal, items, ai_review, steam_trade_urls, display_names } = view
  const isCreator = proposal.creator_id === user.id
  const isParticipant = isCreator || proposal.recipient_id === user.id
  const isDraft = proposal.status === 'draft'
  const isCompleted = proposal.status === 'completed'
  const myMarked = isCreator ? proposal.creator_marked_completed : proposal.recipient_marked_completed
  const otherMarked = isCreator ? proposal.recipient_marked_completed : proposal.creator_marked_completed
  const eitherMarked = proposal.creator_marked_completed || proposal.recipient_marked_completed
  const canEditItems = isDraft && !eitherMarked
  const hasAnyItems = items.creator.length + items.recipient.length > 0
  const initiatorTradeUrl = steam_trade_urls?.creator ?? null
  const counterpartyTradeUrl = isCreator
    ? steam_trade_urls?.recipient ?? null
    : steam_trade_urls?.creator ?? null
  const counterpartyDisplayName = isCreator
    ? display_names?.recipient ?? 'Trader'
    : display_names?.creator ?? 'Trader'

  return (
    <PriceProvider>
    <Layout>
      <ScamWarningBanner />

      <div className="bg-card border border-border rounded p-6 mt-4 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Trade proposal</h1>
            <p className="text-sm text-gray-400 mt-1">
              Status: <span>{STATUS_LABEL[proposal.status]}</span>
            </p>
          </div>
          {isDraft && isParticipant && !eitherMarked && (
            <button onClick={cancel} className="text-sm text-gray-400 hover:text-danger">Cancel</button>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1">Verification code (compare verbally with the other trader before clicking Accept in Steam)</p>
          <VerificationCode code={proposal.verification_code} />
        </div>

        {isCreator && !isCompleted && proposal.status !== 'cancelled' && (
          <div className="mt-5 pt-5 border-t border-border">
            <SendTradeOnSteamButton
              initiatorTradeUrl={initiatorTradeUrl}
              counterpartyTradeUrl={counterpartyTradeUrl}
              counterpartyDisplayName={counterpartyDisplayName}
              conversationId={proposal.conversation_id}
              verificationCode={proposal.verification_code}
              initiatorHasToken={view.viewer_has_steam_webapi_token ?? false}
            />
          </div>
        )}
      </div>

      {hasAnyItems && (
        <div className="mb-6">
          <AgreedItemsPanel
            youSend={isCreator ? items.creator : items.recipient}
            youReceive={isCreator ? items.recipient : items.creator}
          />
        </div>
      )}

      {isParticipant && (isDraft || isCompleted) && (
        <div className="bg-card border border-border rounded p-4 mb-6">
          <h2 className="font-semibold mb-1">Confirm the trade</h2>
          <p className="text-xs text-gray-400 mb-4">
            Mark this trade as completed once you've accepted the offer in Steam and the verification code matches.
          </p>

          {isDraft && (
            <>
              <button
                onClick={markCompleted}
                disabled={marking || myMarked}
                className="bg-accent text-black font-semibold rounded px-4 py-2 disabled:opacity-50"
              >
                {myMarked
                  ? 'You marked this completed'
                  : marking
                  ? 'Marking...'
                  : 'I completed this trade on Steam'}
              </button>

              <p className="text-sm text-gray-400 mt-3">
                {myMarked && !otherMarked && 'Waiting for the other trader to confirm…'}
                {!myMarked && otherMarked && 'The other trader has marked this completed. Verify on Steam, then mark it yourself.'}
                {!myMarked && !otherMarked && 'Neither side has marked the trade completed yet.'}
              </p>

              {eitherMarked && (
                <button
                  onClick={resetMarkCompleted}
                  className="text-xs text-gray-400 hover:text-danger mt-3 underline"
                >
                  Reset mark-completed
                </button>
              )}
            </>
          )}

          {isCompleted && (
            <p className="text-sm text-accent">Both traders confirmed. This trade is closed.</p>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">AI safety review</h2>
          {isDraft && !eitherMarked && isParticipant && (
            <button
              onClick={runAi}
              disabled={aiRunning}
              className="text-sm bg-bg border border-border rounded px-3 py-1 hover:border-accent disabled:opacity-50"
            >
              {aiRunning ? 'Running...' : 'Run AI safety review'}
            </button>
          )}
        </div>
        {ai_review ? (
          <div>
            <p className={`text-sm font-semibold capitalize ${RISK_COLOR[ai_review.risk_level]}`}>
              Risk: {ai_review.risk_level}
            </p>
            {ai_review.warnings.length > 0 && (
              <div className="mt-3">
                <p className="text-xs uppercase text-gray-400 mb-1">Warnings</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {ai_review.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-3">
              <p className="text-xs uppercase text-gray-400 mb-1">Recommended actions</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                {ai_review.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              AI review is advisory only. It does not guarantee trade safety.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No AI review yet.</p>
        )}
      </div>

      {isCompleted && isParticipant && !reviewSent && (
        <div className="bg-card border border-border rounded p-4 mb-6">
          <h2 className="font-semibold mb-3">Leave a review</h2>
          {reviewError && <p className="text-danger text-sm mb-2">{reviewError}</p>}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-gray-400">Rating:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setReviewRating(n)}
                className={`w-8 h-8 rounded ${reviewRating >= n ? 'bg-accent text-black' : 'bg-bg border border-border'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            placeholder="Optional comment"
            maxLength={1000}
            rows={3}
            className="w-full bg-bg border border-border rounded px-3 py-2 mb-3"
          />
          <button onClick={submitReview} className="bg-accent text-black font-semibold rounded px-4 py-2">
            Submit review
          </button>
        </div>
      )}
      {reviewSent && (
        <p className="text-accent text-sm mb-6">Review submitted. Thanks.</p>
      )}

      {canEditItems && isParticipant && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <ItemSide
            title="Your items"
            items={isCreator ? items.creator : items.recipient}
            ownerIsMe={true}
            canEdit={true}
            onAdd={() => { setShowPicker(true); void loadInventory() }}
            onRemove={removeItem}
          />
          <ItemSide
            title="Their items"
            items={isCreator ? items.recipient : items.creator}
            ownerIsMe={false}
            canEdit={false}
            onAdd={() => {}}
            onRemove={removeItem}
          />
        </div>
      )}

      {showPicker && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded max-w-3xl w-full max-h-[80vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Select an item</h3>
              <button onClick={() => setShowPicker(false)} className="text-gray-400 hover:text-white">Close</button>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {inventory.map((it) => (
                <button
                  key={it.asset_id}
                  onClick={() => { void addItem(it); setShowPicker(false) }}
                  className="bg-bg border border-border rounded p-2 text-left hover:border-accent"
                >
                  <img src={it.icon_url} alt="" className="w-full h-20 object-contain mb-2" />
                  <p className="text-xs line-clamp-2">{it.name}</p>
                  {it.wear && <p className="text-[10px] text-gray-400">{it.wear}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-white">← Back</button>
    </Layout>
    </PriceProvider>
  )
}

function ItemSide(props: {
  title: string
  items: TradeItem[]
  ownerIsMe: boolean
  canEdit: boolean
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="bg-card border border-border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{props.title}</h3>
        {props.canEdit && (
          <button onClick={props.onAdd} className="text-xs bg-bg border border-border rounded px-2 py-1 hover:border-accent">
            + Add item
          </button>
        )}
      </div>
      {props.items.length === 0 ? (
        <p className="text-xs text-gray-500">No items yet.</p>
      ) : (
        <ul className="space-y-2">
          {props.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3">
              {i.image_url && <img src={i.image_url} alt="" className="w-10 h-10 object-contain" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{i.name}</p>
                {i.wear && <p className="text-xs text-gray-400">{i.wear}</p>}
              </div>
              {props.canEdit && props.ownerIsMe && (
                <button onClick={() => props.onRemove(i.id)} className="text-xs text-gray-400 hover:text-danger">Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
