import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom doesn't implement matchMedia or IntersectionObserver
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

if (!window.IntersectionObserver) {
  // @ts-expect-error: minimal stub
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

// Stub clipboard for the VerificationCode copy button. configurable:true so
// individual tests can replace it via Object.defineProperty.
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
})

// Default VITE_ env vars used by apps/web/src/lib/supabase.ts and api.ts.
import.meta.env.VITE_SUPABASE_URL ??= 'http://localhost:54321'
import.meta.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key'
import.meta.env.VITE_API_URL ??= 'http://localhost:4000'
