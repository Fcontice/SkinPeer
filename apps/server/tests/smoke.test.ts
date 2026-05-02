import { describe, it, expect } from 'vitest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('test harness', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })

  it('supabase stub records calls', async () => {
    const s = createSupabaseStub()
    s.push({ data: { id: 'x' } })
    const c: any = s.client
    const res = await c.from('foo').select('*').eq('id', 'x').single()
    expect(res.data).toEqual({ id: 'x' })
    expect(s._calls[0].table).toBe('foo')
  })
})
