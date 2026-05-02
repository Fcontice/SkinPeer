import { ReactElement, ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface ProviderOptions {
  router?: MemoryRouterProps
  queryClient?: QueryClient
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  { router, queryClient, ...renderOptions }: ProviderOptions & Omit<RenderOptions, 'wrapper'> = {}
) {
  const client = queryClient ?? makeQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter {...router}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient: client }
}
