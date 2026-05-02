import express from 'express'
import { vi } from 'vitest'
import { createSupabaseStub } from './mockSupabase'

export interface MountedRouter {
  app: express.Express
  supabase: ReturnType<typeof createSupabaseStub>
  setUser: (user: { id: string }) => void
}

interface MountOptions {
  routerPath: string                 // e.g. '../src/routes/proposals'
  mountAt: string                    // e.g. '/api/proposals'
  initialUser?: { id: string }       // populated into req.user by the stubbed authenticate
  isAdmin?: boolean                  // also stubs requireAdmin
  extraMocks?: () => void            // any additional vi.doMock calls before the router import
}

/**
 * Mounts a single router on a fresh Express app with a stubbed Supabase
 * client and a stubbed `authenticate` middleware. Use in `beforeEach`.
 *
 * Example:
 *   const { app, supabase } = await mountRouter({
 *     routerPath: '../src/routes/proposals',
 *     mountAt: '/api/proposals',
 *     initialUser: { id: USER_A },
 *   })
 *   supabase.push({ data: { id: 'p-1', creator_id: USER_A, ... } })
 *   const res = await request(app).get('/api/proposals/p-1')
 */
export async function mountRouter(opts: MountOptions): Promise<MountedRouter> {
  const supabase = createSupabaseStub()
  let currentUser = opts.initialUser ?? { id: 'test-user' }

  vi.resetModules()

  vi.doMock('../src/lib/supabase', () => ({ supabase: supabase.client }))

  vi.doMock('../src/middleware/authenticate', () => ({
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: currentUser.id, email: `${currentUser.id}@test.local` }
      next()
    },
  }))

  vi.doMock('../src/middleware/requireAdmin', () => ({
    requireAdmin: opts.isAdmin
      ? (req: any, _res: any, next: any) => { req.isAdmin = true; next() }
      : (_req: any, res: any, _next: any) => { res.status(403).json({ error: 'Forbidden' }) },
  }))

  opts.extraMocks?.()

  const { default: router } = await import(opts.routerPath)
  const app = express().use(express.json()).use(opts.mountAt, router)

  // Add a final error handler so tests can assert 500 paths cleanly.
  app.use((err: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: 'Internal server error', message: err.message })
  })

  return {
    app,
    supabase,
    setUser: (u) => { currentUser = u },
  }
}
