import { useState } from 'react'
import { useEnsurePrices, usePrices } from '../context/PriceContext'
import type { TradeItem } from '../types/traderNetwork'

interface Props {
  // Items the viewer is sending (their own).
  youSend: TradeItem[]
  // Items the viewer is receiving (the counterparty's).
  youReceive: TradeItem[]
}

export function AgreedItemsPanel({ youSend, youReceive }: Props) {
  const allNames = [...youSend, ...youReceive].map((i) => i.name)
  useEnsurePrices(allNames)

  return (
    <aside className="bg-card border border-border rounded p-4">
      <h2 className="font-semibold mb-1">Agreed items</h2>
      <p className="text-xs text-gray-400 mb-4">
        Steam will not pre-fill items in the trade window — copy each name below into the Steam search.
      </p>

      <Section title="You send" items={youSend} emptyHint="You aren't sending any items in this trade." />
      <div className="my-4 border-t border-border" />
      <Section
        title="You receive"
        items={youReceive}
        emptyHint="They aren't sending any items in this trade."
      />
    </aside>
  )
}

function Section({
  title,
  items,
  emptyHint,
}: {
  title: string
  items: TradeItem[]
  emptyHint: string
}) {
  return (
    <div>
      <p className="text-xs uppercase text-gray-400 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">{emptyHint}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ItemRow({ item }: { item: TradeItem }) {
  const { get } = usePrices()
  const price = get(item.name)
  const [copied, setCopied] = useState(false)

  async function copyName() {
    try {
      await navigator.clipboard.writeText(item.name)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can fail in non-secure contexts; user can still select-and-copy from the row.
    }
  }

  return (
    <li className="flex items-start gap-3">
      {item.image_url && (
        <img
          src={item.image_url}
          alt=""
          className="w-12 h-12 object-contain shrink-0 bg-bg border border-border rounded"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{item.name}</p>
        <p className="text-xs text-gray-400">
          {item.wear ?? '—'}
          {item.float_value != null && (
            <>
              {' · '}float {item.float_value.toFixed(4)}
            </>
          )}
        </p>
        {price ? (
          <p className="text-xs text-gray-300 mt-0.5 font-mono">
            {price.lowest_price ?? price.median_price ?? '—'}
            <span className="text-[10px] text-gray-500 ml-1">
              Steam Market · {timeAgo(price.fetched_at)}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 mt-0.5">Loading price...</p>
        )}
      </div>
      <button
        type="button"
        onClick={copyName}
        className="text-xs bg-bg border border-border rounded px-2 py-1 hover:border-accent shrink-0"
      >
        {copied ? 'Copied' : 'Copy name'}
      </button>
    </li>
  )
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}
