import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const STEAM_LOGIN_URL = `${import.meta.env.VITE_API_URL}/api/auth/steam`

export function LandingPage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm">Loading SkinPeer…</span>
        </div>
      </div>
    )
  }

  if (user) return <Navigate to="/traders" replace />

  return (
    <div className="min-h-screen bg-bg text-white">
      <header className="sticky top-0 z-20 backdrop-blur bg-bg/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2 font-bold">
            <span className="w-2.5 h-2.5 rounded-sm bg-accent shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
            <span className="text-accent">SkinPeer</span>
          </a>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-400">
            <a href="#how-it-works" className="hover:text-white">How it works</a>
            <a href="#safety" className="hover:text-white">Safety</a>
            <a
              href={STEAM_LOGIN_URL}
              className="text-bg bg-accent font-semibold px-3 py-1.5 rounded hover:opacity-90 transition"
            >
              Sign in
            </a>
          </nav>
          <a
            href={STEAM_LOGIN_URL}
            className="sm:hidden text-bg bg-accent font-semibold px-3 py-1.5 rounded text-sm hover:opacity-90"
          >
            Sign in
          </a>
        </div>
      </header>

      <section id="top" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.18),transparent_55%)]"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-accent/90 bg-accent/10 border border-accent/30 rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Verification-first CS2 trading
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-5 max-w-3xl mx-auto">
            A safer way to coordinate <span className="text-accent">CS2 skin trades</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
            Find trusted traders, message them directly, and verify every proposal with a unique
            code before you click Accept in Steam.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <a
              href={STEAM_LOGIN_URL}
              className="inline-flex items-center justify-center gap-2 bg-accent text-bg font-semibold px-6 py-3 rounded-md hover:opacity-90 transition shadow-[0_0_24px_rgba(16,185,129,0.25)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.38l3.01-6.24A3.5 3.5 0 0 1 12 10.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5 3.5 3.5 0 0 1-3.1-1.87L3.3 18.5A12 12 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z" />
              </svg>
              Sign in with Steam
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 bg-card border border-border text-gray-300 font-medium px-6 py-3 rounded-md hover:border-accent/50 hover:text-white transition"
            >
              See how it works
            </a>
          </div>

          <div className="max-w-md mx-auto bg-card border border-border rounded-xl p-6 text-left shadow-[0_0_40px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs uppercase tracking-wider text-gray-500">Verification code</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Both parties matched
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 bg-bg border border-border rounded-md px-4 py-3 mb-3">
              <p className="font-mono text-2xl sm:text-3xl tracking-[0.3em] text-accent">
                7K3M9P
              </p>
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-white border border-border rounded px-2 py-1"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Compare this code with your trade partner before clicking Accept inside Steam.
              <span className="text-gray-300"> If the codes don't match, stop the trade.</span>
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-border bg-card/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">How it works</h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              Three simple steps. The trade itself happens directly inside Steam — we never touch your items.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                n: '01',
                title: 'Find a trader',
                body: 'Browse verified Steam traders, check ratings and trade history, then start a conversation.',
              },
              {
                n: '02',
                title: 'Propose the trade',
                body: 'Build a proposal with both sides’ items. Each proposal gets a unique verification code.',
              },
              {
                n: '03',
                title: 'Verify and trade',
                body: 'Compare the verification code on both sides, then complete the trade in Steam yourself.',
              },
            ].map((step) => (
              <div
                key={step.n}
                className="bg-card border border-border rounded-xl p-6 hover:border-accent/40 transition"
              >
                <p className="text-accent font-mono text-sm mb-3">{step.n}</p>
                <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="safety" className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">What we don't do</h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              SkinPeer is intentionally narrow. We coordinate — Steam handles the trade.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: 'No bots',
                body: 'No automated trade bots. You always trade directly with the other person.',
              },
              {
                title: 'No custody',
                body: 'We never hold or store your skins. They stay in your Steam inventory.',
              },
              {
                title: 'No escrow',
                body: 'No middleman releasing items. The Steam trade window is the only handoff.',
              },
              {
                title: 'Steam-direct',
                body: 'Every trade happens inside Steam, between you and your counterparty.',
              },
            ].map((card) => (
              <div
                key={card.title}
                className="bg-card border border-border rounded-xl p-5 hover:border-accent/40 transition"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  <h3 className="font-semibold">{card.title}</h3>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 text-center">
          <p className="text-xs text-gray-500 max-w-2xl mx-auto leading-relaxed">
            SkinPeer is not affiliated with or endorsed by Valve or Steam. We do not hold or escrow CS2
            items and we do not run Steam trade bots. Always verify items, floats, and stickers inside
            Steam before clicking Accept.
          </p>
          <p className="text-xs text-gray-600 mt-4">© {new Date().getFullYear()} SkinPeer</p>
        </div>
      </footer>
    </div>
  )
}
