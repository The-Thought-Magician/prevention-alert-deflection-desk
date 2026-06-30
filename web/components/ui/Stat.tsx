import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'orange' | 'green' | 'red'
  className?: string
}

const valueTones = {
  default: 'text-slate-100',
  orange: 'text-orange-400',
  green: 'text-emerald-400',
  red: 'text-red-400',
}

export function Stat({ label, value, sub, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/80 p-5 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${valueTones[tone]}`}>{value}</div>
      {sub != null && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  )
}

export default Stat
