import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { isValidSteamTradeUrl } from '../../../../packages/shared/src/steamTradeUrl'

// Reusable modal used by EditProfilePage and the Send-on-Steam gate.
// Each input has its own validate-on-save CONFIRM button. The trade URL
// is required (DONE stays disabled until it's saved or already on file);
// the WebAPI token is optional. Server returns has_steam_webapi_token —
// plaintext token is never round-tripped back.

interface SaveResponse {
  steam_trade_url: string | null
  has_steam_webapi_token: boolean
  tokenError?: string
}

interface Props {
  open: boolean
  onClose: () => void
  // Initial state surfaced from the parent. The modal renders the URL
  // collapsed-into-input — letting the user replace the existing value.
  initialTradeUrl: string | null
  initialHasToken: boolean
  // Fired after the trade URL is successfully saved (or already on file
  // when DONE is clicked). The Send-on-Steam gate uses this to retry the
  // original action without forcing a second click.
  onSaved: (next: { steam_trade_url: string | null; has_steam_webapi_token: boolean }) => void
}

export function SteamTradeUrlModal({
  open,
  onClose,
  initialTradeUrl,
  initialHasToken,
  onSaved,
}: Props) {
  const [tradeUrl, setTradeUrl] = useState(initialTradeUrl ?? '')
  const [tradeUrlSaved, setTradeUrlSaved] = useState(!!initialTradeUrl)
  const [tradeUrlError, setTradeUrlError] = useState<string | null>(null)
  const [tradeUrlBusy, setTradeUrlBusy] = useState(false)

  const [token, setToken] = useState('')
  const [tokenSaved, setTokenSaved] = useState(initialHasToken)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  // Reset internal state when reopening with new props.
  useEffect(() => {
    if (!open) return
    setTradeUrl(initialTradeUrl ?? '')
    setTradeUrlSaved(!!initialTradeUrl)
    setTradeUrlError(null)
    setToken('')
    setTokenSaved(initialHasToken)
    setTokenError(null)
  }, [open, initialTradeUrl, initialHasToken])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const trimmedUrl = tradeUrl.trim()
  const urlClientInvalid = trimmedUrl.length > 0 && !isValidSteamTradeUrl(trimmedUrl)

  async function confirmTradeUrl() {
    setTradeUrlError(null)
    if (!isValidSteamTradeUrl(trimmedUrl)) {
      setTradeUrlError(
        "That doesn't look like a Steam trade URL — make sure both partner and token are present.",
      )
      return
    }
    setTradeUrlBusy(true)
    try {
      const res = await apiFetch<SaveResponse>('/traders/me/steam-trade-url', {
        method: 'PATCH',
        body: JSON.stringify({ steam_trade_url: trimmedUrl }),
      })
      setTradeUrlSaved(true)
      onSaved({
        steam_trade_url: res.steam_trade_url,
        has_steam_webapi_token: res.has_steam_webapi_token,
      })
    } catch (e) {
      setTradeUrlError(e instanceof Error ? e.message : 'Could not save trade URL')
    } finally {
      setTradeUrlBusy(false)
    }
  }

  async function confirmToken() {
    setTokenError(null)
    const trimmed = token.trim()
    if (!trimmed) {
      setTokenError('Paste your Steam WebAPI token first.')
      return
    }
    setTokenBusy(true)
    try {
      const res = await apiFetch<SaveResponse>('/traders/me/steam-trade-url', {
        method: 'PATCH',
        body: JSON.stringify({ steam_webapi_token: trimmed }),
      })
      if (res.tokenError) {
        setTokenError(res.tokenError)
        return
      }
      setTokenSaved(res.has_steam_webapi_token)
      setToken('')
      onSaved({
        steam_trade_url: res.steam_trade_url,
        has_steam_webapi_token: res.has_steam_webapi_token,
      })
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : 'Could not save token')
    } finally {
      setTokenBusy(false)
    }
  }

  function handleDone() {
    if (!tradeUrlSaved) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="steam-trade-url-modal-title"
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h2
            id="steam-trade-url-modal-title"
            className="text-xs font-semibold tracking-[0.2em] text-gray-300 uppercase"
          >
            Steam trade URL
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-bg"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* Steam trade URL — required */}
          <section>
            <p className="text-xs text-gray-400 leading-relaxed mb-2">
              Change your Steam Trade URL to continue.{' '}
              <a
                href="https://steamcommunity.com/id/me/tradeoffers/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                You can find it here.
              </a>
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={tradeUrl}
                onChange={(e) => {
                  setTradeUrl(e.target.value)
                  setTradeUrlSaved(false)
                  setTradeUrlError(null)
                }}
                maxLength={300}
                placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..."
                className={`flex-1 min-w-0 bg-bg border rounded px-3 py-2 text-sm placeholder:text-gray-600 ${
                  tradeUrlError || urlClientInvalid ? 'border-danger' : 'border-border'
                }`}
              />
              <button
                type="button"
                onClick={confirmTradeUrl}
                disabled={tradeUrlBusy || trimmedUrl.length === 0}
                className="bg-accent text-bg font-semibold rounded px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50 hover:opacity-90 transition"
              >
                {tradeUrlBusy ? 'Saving' : 'Confirm'}
              </button>
            </div>
            {tradeUrlError && (
              <p className="text-xs text-danger mt-2">{tradeUrlError}</p>
            )}
            {tradeUrlSaved && !tradeUrlError && (
              <p className="text-xs text-accent mt-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                Saved
              </p>
            )}
          </section>

          {/* Steam WebAPI token — optional */}
          <section>
            <div className="bg-bg border border-border rounded p-4 mb-3">
              <p className="text-xs font-semibold tracking-[0.15em] text-gray-300 uppercase mb-2">
                How to obtain your token?
              </p>
              <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Make sure that you are signed in to Steam in your browser</li>
                <li>
                  Visit{' '}
                  <a
                    href="https://steamcommunity.com/pointssummary/ajaxgetasyncconfig"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline break-all"
                  >
                    steamcommunity.com/pointssummary/ajaxgetasyncconfig
                  </a>
                </li>
                <li>
                  Copy your <span className="font-mono text-gray-300">webapi_token</span>
                </li>
              </ol>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed mb-2">
              We require your Steam token to retrieve any items added to your Steam inventory within
              the last 10 days. We suggest you add your WebAPI token to have a better and smoother
              experience.{' '}
              <a
                href="https://steamcommunity.com/dev/apiterms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Read more about the token here.
              </a>
            </p>
            <label
              htmlFor="steam-webapi-token-input"
              className="block text-xs text-gray-400 mb-1"
            >
              Steam WebAPI Token
            </label>
            <div className="flex gap-2">
              <input
                id="steam-webapi-token-input"
                type="text"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setTokenError(null)
                }}
                maxLength={2000}
                placeholder="Steam WebAPI Token: e.g. eyAldHIwlJoglkpXVC..."
                className={`flex-1 min-w-0 bg-bg border rounded px-3 py-2 text-sm placeholder:text-gray-600 font-mono ${
                  tokenError ? 'border-danger' : 'border-border'
                }`}
              />
              <button
                type="button"
                onClick={confirmToken}
                disabled={tokenBusy || token.trim().length === 0}
                className="bg-accent text-bg font-semibold rounded px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50 hover:opacity-90 transition"
              >
                {tokenBusy ? 'Saving' : 'Confirm'}
              </button>
            </div>
            {tokenError && (
              <p className="text-xs text-danger mt-2">{tokenError}</p>
            )}
            {tokenSaved && !tokenError && (
              <p className="text-xs text-accent mt-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                Token saved
              </p>
            )}
          </section>
        </div>

        <div className="px-5 pb-5 pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleDone}
            disabled={!tradeUrlSaved}
            className="w-full bg-accent text-bg font-semibold rounded py-3 text-sm tracking-[0.15em] uppercase disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            Done
          </button>
          {!tradeUrlSaved && (
            <p className="text-[11px] text-gray-500 text-center mt-2">
              Confirm your Steam trade URL to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
