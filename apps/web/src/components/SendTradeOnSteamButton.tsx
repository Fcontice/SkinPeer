import { useState } from 'react'
import {
  buildSteamTradeOfferUrl,
  parseSteamTradeUrl,
} from '../../../../packages/shared/src/steamTradeUrl'
import { apiFetch } from '../lib/api'
import { SteamTradeUrlModal } from './SteamTradeUrlModal'

interface Props {
  // The proposal creator's URL — required so we can warn the initiator if
  // they have not configured one yet.
  initiatorTradeUrl: string | null
  // The counterparty's URL — its partner+token form the deeplink target.
  counterpartyTradeUrl: string | null
  // Display name for the counterparty, used in the inline missing-URL message.
  counterpartyDisplayName: string
  // Conversation that owns this proposal — used to post the reminder system
  // message when the counterparty's URL is missing.
  conversationId: string
  verificationCode: string
  // Whether the current user already has a WebAPI token saved. Forwarded to
  // the helper modal so it can pre-fill the saved-state indicator.
  initiatorHasToken: boolean
}

// Visible only to the proposal creator. Steam's /tradeoffer/new/ deeplink
// accepts only partner, token, and message — items cannot be pre-populated
// (Steam design). The agreed-items panel is the workaround.
//
// Gating rules (per spec):
//   - both URLs present  → opens deeplink
//   - clicker missing    → opens helper modal inline; on save, retries
//   - counterparty missing → does not open the modal (cannot fix for them);
//     shows inline message + "Send reminder message" action that posts a
//     system message in the chat
export function SendTradeOnSteamButton({
  initiatorTradeUrl,
  counterpartyTradeUrl,
  counterpartyDisplayName,
  conversationId,
  verificationCode,
  initiatorHasToken,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  // Snapshot of the initiator's URL — modal saves bump this without a refetch.
  const [liveInitiatorUrl, setLiveInitiatorUrl] = useState(initiatorTradeUrl)
  const [liveHasToken, setLiveHasToken] = useState(initiatorHasToken)
  // True when the user clicked Send and was blocked because their URL was
  // missing. After they save in the modal, we auto-open the deeplink.
  const [pendingSendOnSave, setPendingSendOnSave] = useState(false)

  const [reminderState, setReminderState] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle')
  const [reminderError, setReminderError] = useState<string | null>(null)

  const counterparty = parseSteamTradeUrl(counterpartyTradeUrl)
  const initiator = parseSteamTradeUrl(liveInitiatorUrl)

  const baseClasses =
    'inline-flex items-center justify-center bg-accent text-bg font-semibold rounded px-4 py-2 hover:opacity-90 transition'

  function openSteamDeeplink(target: ReturnType<typeof parseSteamTradeUrl>) {
    if (!target) return
    const href = buildSteamTradeOfferUrl(target.partner, target.token, verificationCode)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  function handleClick() {
    if (!initiator) {
      setPendingSendOnSave(true)
      setModalOpen(true)
      return
    }
    if (!counterparty) {
      // Counterparty path is rendered as the missing-counterparty block below;
      // nothing to do on click.
      return
    }
    openSteamDeeplink(counterparty)
  }

  function handleModalSaved(next: { steam_trade_url: string | null; has_steam_webapi_token: boolean }) {
    setLiveInitiatorUrl(next.steam_trade_url)
    setLiveHasToken(next.has_steam_webapi_token)
  }

  function handleModalClose() {
    setModalOpen(false)
    if (pendingSendOnSave) {
      setPendingSendOnSave(false)
      // If the save completed during this modal session, retry automatically.
      const justSaved = parseSteamTradeUrl(liveInitiatorUrl)
      if (justSaved && counterparty) {
        openSteamDeeplink(counterparty)
      }
    }
  }

  async function sendReminder() {
    setReminderError(null)
    setReminderState('sending')
    try {
      await apiFetch(`/conversations/${conversationId}/steam-trade-url-reminder`, {
        method: 'POST',
      })
      setReminderState('sent')
    } catch (e) {
      setReminderState('error')
      setReminderError(e instanceof Error ? e.message : 'Could not send reminder')
    }
  }

  // Counterparty missing — render the dedicated reminder block. Don't open
  // the helper modal (we cannot fix it for them).
  if (!counterparty) {
    return (
      <div>
        <button
          type="button"
          onClick={handleClick}
          className={baseClasses}
          disabled={!initiator}
          title={!initiator ? 'Add your Steam trade URL first' : undefined}
        >
          Send trade on Steam
        </button>
        <div className="mt-3 bg-warning/10 border border-warning/40 rounded p-3 text-sm">
          <p className="text-gray-200 leading-relaxed">
            <span className="font-semibold">{counterpartyDisplayName}</span> hasn't added their
            Steam trade URL yet. Send them a message to add one on their profile, then try again.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={sendReminder}
              disabled={reminderState === 'sending' || reminderState === 'sent'}
              className="text-xs bg-card border border-border rounded px-3 py-1.5 hover:border-accent transition disabled:opacity-50"
            >
              {reminderState === 'sending'
                ? 'Sending…'
                : reminderState === 'sent'
                ? 'Reminder sent'
                : 'Send reminder message'}
            </button>
            {reminderError && <span className="text-xs text-danger">{reminderError}</span>}
          </div>
        </div>
        <SteamTradeUrlModal
          open={modalOpen}
          onClose={handleModalClose}
          initialTradeUrl={liveInitiatorUrl}
          initialHasToken={liveHasToken}
          onSaved={handleModalSaved}
        />
      </div>
    )
  }

  // Counterparty is good. The button always renders enabled — if the
  // initiator URL is missing, the click handler opens the modal first.
  return (
    <div>
      <button type="button" onClick={handleClick} className={baseClasses}>
        Send trade on Steam
      </button>
      <p className="text-xs text-gray-400 mt-2">
        Opens Steam in a new tab. Items cannot be pre-populated — use the agreed-items list to copy
        each name into the Steam trade window.
      </p>
      <SteamTradeUrlModal
        open={modalOpen}
        onClose={handleModalClose}
        initialTradeUrl={liveInitiatorUrl}
        initialHasToken={liveHasToken}
        onSaved={handleModalSaved}
      />
    </div>
  )
}
