import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { SteamTradeUrlModal } from '../components/SteamTradeUrlModal'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { TraderProfile } from '../types/traderNetwork'
import { parseSteamTradeUrl } from '../../../../packages/shared/src/steamTradeUrl'

type SteamTradeSavePayload = {
  steam_trade_url: string | null
  has_steam_webapi_token: boolean
}

// Compact toggle switch — inlined since this is the only place it's used so far.
function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left"
    >
      <div>
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <span
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
          checked ? 'bg-accent border-accent' : 'bg-bg border-border'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-px ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function maskTradeUrl(url: string | null): string {
  if (!url) return ''
  const parsed = parseSteamTradeUrl(url)
  if (!parsed) return url
  return `https://steamcommunity.com/tradeoffer/new/?partner=${parsed.partner}&token=••••••••`
}

export function EditProfilePage() {
  const navigate = useNavigate()
  const { user, profile: authProfile, signOut } = useAuth()

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedToast, setSavedToast] = useState(false)

  // Initial values — used to detect unsaved changes for the sticky save bar.
  const [initial, setInitial] = useState<{
    display_name: string
    bio: string
    trade_preferences: string
    accepting_trades: boolean
    is_public: boolean
  } | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [tradePreferences, setTradePreferences] = useState('')
  const [acceptingTrades, setAcceptingTrades] = useState(true)
  const [isPublic, setIsPublic] = useState(true)

  const [steamTradeUrl, setSteamTradeUrl] = useState<string | null>(null)
  const [hasSteamToken, setHasSteamToken] = useState(false)
  const [steamSectionExpanded, setSteamSectionExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [removingTradeUrl, setRemovingTradeUrl] = useState(false)

  useEffect(() => {
    apiFetch<TraderProfile>('/traders/me/profile')
      .then((p) => {
        setDisplayName(p.display_name ?? '')
        setBio(p.bio ?? '')
        setTradePreferences(p.trade_preferences ?? '')
        setAcceptingTrades(p.accepting_trades)
        setIsPublic(p.is_public ?? true)
        setSteamTradeUrl(p.steam_trade_url ?? null)
        setHasSteamToken(p.has_steam_webapi_token ?? false)
        setInitial({
          display_name: p.display_name ?? '',
          bio: p.bio ?? '',
          trade_preferences: p.trade_preferences ?? '',
          accepting_trades: p.accepting_trades,
          is_public: p.is_public ?? true,
        })
        setLoaded(true)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const dirty = useMemo(() => {
    if (!initial) return false
    return (
      initial.display_name !== displayName ||
      initial.bio !== bio ||
      initial.trade_preferences !== tradePreferences ||
      initial.accepting_trades !== acceptingTrades ||
      initial.is_public !== isPublic
    )
  }, [initial, displayName, bio, tradePreferences, acceptingTrades, isPublic])

  async function handleSave() {
    if (!dirty) return
    setSaving(true)
    setError(null)
    setSavedToast(false)
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
      setInitial({
        display_name: displayName,
        bio: bio,
        trade_preferences: tradePreferences,
        accepting_trades: acceptingTrades,
        is_public: isPublic,
      })
      setSavedToast(true)
      window.setTimeout(() => setSavedToast(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleModalSaved(next: SteamTradeSavePayload) {
    setSteamTradeUrl(next.steam_trade_url)
    setHasSteamToken(next.has_steam_webapi_token)
  }

  async function handleRemoveTradeUrl() {
    if (!confirm('Remove your Steam trade URL and WebAPI token?')) return
    setRemovingTradeUrl(true)
    try {
      const res = await apiFetch<SteamTradeSavePayload>('/traders/me/steam-trade-url', {
        method: 'DELETE',
      })
      setSteamTradeUrl(res.steam_trade_url)
      setHasSteamToken(res.has_steam_webapi_token)
      setSteamSectionExpanded(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
    } finally {
      setRemovingTradeUrl(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  if (!loaded && !error) {
    return (
      <Layout>
        <p className="text-gray-400">Loading...</p>
      </Layout>
    )
  }

  const steamId = authProfile?.steam_id ?? null
  const steamProfileUrl = steamId ? `https://steamcommunity.com/profiles/${steamId}` : null
  const accountCreated = authProfile?.created_at ? new Date(authProfile.created_at) : null
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at) : null
  const avatar = authProfile?.steam_avatar ?? authProfile?.avatar_url ?? null

  return (
    <Layout>
      <div className="max-w-[720px] mx-auto pb-24">
        {/* Header */}
        <header className="flex items-center gap-5 mb-8">
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="w-20 h-20 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-card border border-border flex items-center justify-center text-2xl text-gray-500">
              {displayName.slice(0, 1).toUpperCase() || '?'}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight truncate">
              {displayName || authProfile?.steam_persona || 'Your profile'}
            </h1>
            {steamProfileUrl && (
              <a
                href={steamProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-accent transition inline-flex items-center gap-1.5 mt-1"
              >
                View Steam profile
                <span aria-hidden>↗</span>
              </a>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-4 bg-danger/10 border border-danger/40 rounded px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Card 1 — Identity */}
        <Card title="Identity">
          <div className="space-y-4">
            <Field label="Display name" hint={`${displayName.length}/60`}>
              <input
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Bio" hint={`${bio.length}/500`}>
              <textarea
                maxLength={500}
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell other traders what you collect, what you're looking for, anything that builds trust."
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm focus:border-accent focus:outline-none placeholder:text-gray-600"
              />
            </Field>
          </div>
        </Card>

        {/* Card 2 — Trade preferences */}
        <Card title="Trade preferences">
          <div className="space-y-5">
            <Field label="What you're trading" hint={`${tradePreferences.length}/500`}>
              <input
                maxLength={500}
                value={tradePreferences}
                onChange={(e) => setTradePreferences(e.target.value)}
                placeholder="e.g. Knives for high-tier rifles, no overpay"
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm focus:border-accent focus:outline-none placeholder:text-gray-600"
              />
            </Field>
            <div className="border-t border-border pt-4">
              <ToggleSwitch
                checked={acceptingTrades}
                onChange={setAcceptingTrades}
                label="Currently accepting trades"
                description="Off-hours? Toggle this off and other traders will see your status as paused."
              />
            </div>
            <div className="border-t border-border pt-4">
              <ToggleSwitch
                checked={isPublic}
                onChange={setIsPublic}
                label="List me in Find Traders"
                description="Required to appear in the public traders directory."
              />
            </div>
          </div>
        </Card>

        {/* Card 3 — Steam connection */}
        <Card title="Steam connection">
          <div className="space-y-4">
            <ReadOnlyRow label="Steam ID" value={steamId ?? '—'} mono />
            <ReadOnlyRow
              label="Steam profile"
              value={steamProfileUrl ?? '—'}
              link={steamProfileUrl}
            />

            {/* Steam Trade URL — collapsed-with-status by default */}
            <div className="border-t border-border pt-4">
              {steamTradeUrl ? (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                      <span>Steam trade URL saved</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSteamSectionExpanded((v) => !v)}
                      className="text-xs text-gray-400 hover:text-accent"
                    >
                      {steamSectionExpanded ? 'Hide' : 'Manage'}
                    </button>
                  </div>
                  {steamSectionExpanded && (
                    <div className="mt-4 space-y-3 bg-bg border border-border rounded p-3">
                      <p className="text-[11px] uppercase tracking-wider text-gray-500">
                        Saved trade URL
                      </p>
                      <p className="font-mono text-xs text-gray-300 break-all">
                        {maskTradeUrl(steamTradeUrl)}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        {hasSteamToken ? (
                          <span className="inline-flex items-center gap-1.5 text-accent">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                            WebAPI token saved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-warning">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                            WebAPI token not set
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setModalOpen(true)}
                          className="text-xs bg-card border border-border rounded px-3 py-1.5 hover:border-accent transition"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveTradeUrl}
                          disabled={removingTradeUrl}
                          className="text-xs text-gray-400 hover:text-danger disabled:opacity-50"
                        >
                          {removingTradeUrl ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-warning shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                    <span>Steam trade URL not set — required to send trades</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="text-xs bg-accent text-bg font-semibold rounded px-3 py-1.5 hover:opacity-90 transition"
                  >
                    Add trade URL
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Card 4 — Account */}
        <Card title="Account">
          <div className="space-y-3">
            <ReadOnlyRow
              label="Created"
              value={accountCreated ? accountCreated.toLocaleDateString() : '—'}
            />
            <ReadOnlyRow
              label="Last sign-in"
              value={lastSignIn ? lastSignIn.toLocaleString() : '—'}
            />
            <div className="border-t border-border pt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleSignOut}
                className="text-sm bg-card border border-border rounded px-4 py-2 hover:border-accent transition"
              >
                Sign out
              </button>
              <button
                type="button"
                disabled
                title="Account deletion is not yet wired up — contact support to remove your account."
                className="text-sm text-danger/70 hover:text-danger underline-offset-2 hover:underline disabled:cursor-not-allowed"
              >
                Delete account
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* Sticky save bar — only when there are unsaved changes */}
      {dirty && (
        <div className="fixed bottom-6 right-6 z-30 flex items-center gap-3 bg-card border border-border rounded-lg shadow-2xl px-4 py-3">
          <p className="text-xs text-gray-400">Unsaved changes</p>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-bg font-semibold rounded px-4 py-2 text-sm disabled:opacity-50 hover:opacity-90 transition"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {/* Saved toast */}
      {savedToast && !dirty && (
        <div className="fixed bottom-6 right-6 z-30 bg-accent/15 border border-accent/40 text-accent rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          Saved
        </div>
      )}

      <SteamTradeUrlModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialTradeUrl={steamTradeUrl}
        initialHasToken={hasSteamToken}
        onSaved={handleModalSaved}
      />
    </Layout>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 sm:p-6 mb-5 hover:border-border/80 transition shadow-[0_0_24px_rgba(0,0,0,0.25)]">
      <h2 className="text-sm font-semibold tracking-[0.15em] uppercase text-gray-300 mb-4">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-gray-400">{label}</label>
        {hint && <span className="text-[11px] text-gray-600">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ReadOnlyRow({
  label,
  value,
  link,
  mono,
}: {
  label: string
  value: string
  link?: string | null
  mono?: boolean
}) {
  const valueClass = `text-sm text-gray-300 break-all ${mono ? 'font-mono' : ''}`
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 text-xs uppercase tracking-wider mt-0.5">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className={`${valueClass} hover:text-accent transition`}
        >
          {value}
        </a>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
    </div>
  )
}
