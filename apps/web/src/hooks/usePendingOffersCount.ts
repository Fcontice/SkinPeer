import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function usePendingOffersCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  async function refresh() {
    try {
      const data = await apiFetch<{ count: number }>('/offers/inbound/pending')
      setCount(data.count)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!user) return
    void refresh()
    const ch = supabase
      .channel(`offers-inbound:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers', filter: `to_user_id=eq.${user.id}` },
        () => void refresh()
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return count
}
