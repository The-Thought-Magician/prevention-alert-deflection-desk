interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-3 text-slate-400 ${className}`}>
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
