type Row = Record<string, unknown>

interface Stub {
  _inbox: Array<{ data: Row | Row[] | null; error: unknown | null; count: number | null }>
  _calls: Array<{ table: string; op: string; args: unknown[] }>
  push(response: { data: Row | Row[] | null; error?: unknown; count?: number | null }): void
  reset(): void
}

export function createSupabaseStub(): Stub & { client: { from: (table: string) => any } } {
  const stub: Stub = {
    _inbox: [],
    _calls: [],
    push(resp) { stub._inbox.push({ error: null, count: null, ...resp }) },
    reset() { stub._inbox = []; stub._calls = [] },
  }

  function next() {
    return stub._inbox.shift() ?? { data: null, error: null, count: null }
  }

  function makeQuery(table: string, op: string, args: unknown[] = []): any {
    stub._calls.push({ table, op, args })
    const q: any = {
      select: (...a: unknown[]) => makeQuery(table, 'select', a),
      insert: (...a: unknown[]) => makeQuery(table, 'insert', a),
      update: (...a: unknown[]) => makeQuery(table, 'update', a),
      delete: () => makeQuery(table, 'delete', []),
      upsert: (...a: unknown[]) => makeQuery(table, 'upsert', a),
      eq: () => q,
      neq: () => q,
      gt: () => q,
      lt: () => q,
      gte: () => q,
      lte: () => q,
      or: () => q,
      in: () => q,
      is: () => q,
      ilike: () => q,
      like: () => q,
      contains: () => q,
      order: () => q,
      limit: () => q,
      range: () => q,
      maybeSingle: () => Promise.resolve(next()),
      single: () => Promise.resolve(next()),
      then: (cb: any) => Promise.resolve(next()).then(cb),
    }
    return q
  }

  const client = { from: (table: string) => makeQuery(table, 'from') }
  return Object.assign(stub, { client })
}
