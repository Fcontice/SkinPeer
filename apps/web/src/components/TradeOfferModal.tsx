import { useEffect, useState } from 'react'
import { TradeOfferCard } from './TradeOfferCard'
import { PriceProvider } from '../context/PriceContext'
import type { OfferChain } from '../lib/offerChains'

interface Props {
  chain: OfferChain
  onClose: () => void
  onChange?: () => void
}

export function TradeOfferModal({ chain, onClose, onChange }: Props) {
  const [manuallyExpanded, setManuallyExpanded] = useState(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 pt-2">
          <h2 className="text-sm font-semibold text-gray-200">Trade proposal</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-bg"
          >
            ×
          </button>
        </div>
        <PriceProvider>
          <TradeOfferCard
            chain={chain}
            defaultMinimized={false}
            manuallyExpanded={manuallyExpanded}
            onManualExpand={() => setManuallyExpanded((v) => !v)}
            onChange={onChange}
          />
        </PriceProvider>
      </div>
    </div>
  )
}
