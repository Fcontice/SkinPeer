import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import type { MarketPrice } from '../types/traderNetwork'

interface PriceContextValue {
  get: (name: string) => MarketPrice | null
  ensure: (names: string[]) => void
}

const PriceContext = createContext<PriceContextValue>({
  get: () => null,
  ensure: () => {},
})

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [prices, setPrices] = useState<Record<string, MarketPrice>>({})
  const inFlight = useRef<Set<string>>(new Set())
  const failed = useRef<Set<string>>(new Set())

  const ensure = useCallback((names: string[]) => {
    const todo: string[] = []
    for (const n of names) {
      if (!n) continue
      if (n in prices) continue
      if (inFlight.current.has(n)) continue
      if (failed.current.has(n)) continue
      todo.push(n)
      inFlight.current.add(n)
    }
    if (todo.length === 0) return

    void Promise.allSettled(
      todo.map((n) => apiFetch<MarketPrice>(`/market/price?name=${encodeURIComponent(n)}`)),
    ).then((results) => {
      const next: Record<string, MarketPrice> = {}
      results.forEach((r, i) => {
        const name = todo[i]
        inFlight.current.delete(name)
        if (r.status === 'fulfilled') next[name] = r.value
        else failed.current.add(name)
      })
      if (Object.keys(next).length > 0) {
        setPrices((prev) => ({ ...prev, ...next }))
      }
    })
  }, [prices])

  const get = useCallback((name: string) => prices[name] ?? null, [prices])

  return <PriceContext.Provider value={{ get, ensure }}>{children}</PriceContext.Provider>
}

export function usePrices() {
  return useContext(PriceContext)
}

export function useEnsurePrices(names: string[]) {
  const { ensure } = usePrices()
  const key = names.join('|')
  useEffect(() => {
    ensure(names)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
