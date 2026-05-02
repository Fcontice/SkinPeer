import { useState } from 'react'

export function VerificationCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 text-center">
      <p className="text-sm text-gray-400 mb-2">Verification code — both traders should compare this before completing in Steam</p>
      <p className="font-mono text-3xl font-bold text-accent tracking-widest mb-3">{code}</p>
      <p className="text-xs text-gray-500 mb-4">
        Read this code aloud or share it through a separate channel. If the other trader sees a different
        code, stop the trade immediately.
      </p>
      <button
        onClick={handleCopy}
        className="bg-accent text-bg font-semibold px-6 py-2 rounded hover:opacity-90 transition-opacity"
      >
        {copied ? '✓ Copied!' : 'Copy Code'}
      </button>
    </div>
  )
}
