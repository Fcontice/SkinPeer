export function ScamWarningBanner() {
  return (
    <div className="bg-danger/10 border border-danger rounded-lg p-4 mb-6">
      <p className="text-danger font-semibold text-sm">
        ⚠ SCAM WARNING: Never accept a Steam trade where the verification code in the trade message does not exactly match the code shown on this page. If the code is missing or different — cancel the trade immediately and do not proceed.
      </p>
    </div>
  )
}
