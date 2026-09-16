'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Award, Gift, Clock, ShieldCheck } from 'lucide-react'
import { CreditsPageSkeleton } from '../_components/skeletons/CreditsPageSkeleton'
import { redirectToCurrentPortalLogin } from '@/app/_components/portal/portalClientRedirect'
import { formatLocaleDate } from '@/lib/utils/format-date'
import './credits.css'

type CreditEntry = {
  id: string
  creditCode: string
  amount: number
  reason: string
  description: string
  status: 'available' | 'used'
  earnedAt: string
  usedMonth: string | null
  usedYear: string | null
  usedAt: string | null
}

type CreditsData = {
  credits: CreditEntry[]
  availableCredits: CreditEntry[]
  totalAvailable: number
  totalUsed: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

/** usedMonth arrives as a full month name (e.g. "January" or "Nov"). */
function monthAbbreviation(value: string | null | undefined) {
  const key = String(value || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(MONTH_INDEX_BY_NAME, key)) return MONTHS[MONTH_INDEX_BY_NAME[key]]
  const numeric = Number(key)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return MONTHS[numeric - 1]
  return key
}

export default function CreditsClient() {
  const [data, setData] = useState<CreditsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'available' | 'used'>('all')

  useEffect(() => {
    let cancelled = false
    async function loadCredits() {
      try {
        const res = await fetch('/api/portal/credits', { cache: 'no-store' })
        if (res.status === 401) {
          redirectToCurrentPortalLogin()
          return
        }
        if (!res.ok) throw new Error('Unable to load student credits.')
        const result = await res.json()
        if (!cancelled) setData(result.data || result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error loading credits')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadCredits()
    return () => { cancelled = true }
  }, [])

  if (loading) return <CreditsPageSkeleton />

  const filteredCredits = data?.credits.filter(c => {
    if (filter === 'all') return true
    return c.status === filter
  }) || []

  return (
    <div className="credits-page">
      <motion.div className="credits-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Student Credits</h1>
        <p>Track your earned credits from achievements, events, and referrals.</p>
      </motion.div>

      {error ? (
        <div className="credits-error">{error}</div>
      ) : data ? (
        <div className="credits-content">
          
          <section className="credits-summary">
            <div className="credits-summary-card">
              <div className="credits-summary-icon credits-summary-icon--available">
                <ShieldCheck size={24} />
              </div>
              <div>
                <div className="credits-summary-label">Available Balance</div>
                <div className="credits-summary-value">₹{data.totalAvailable.toLocaleString('en-IN')}</div>
              </div>
            </div>

            <div className="credits-summary-card">
              <div className="credits-summary-icon credits-summary-icon--redeemed">
                <Clock size={24} />
              </div>
              <div>
                <div className="credits-summary-label">Lifetime Redeemed</div>
                <div className="credits-summary-value">₹{data.totalUsed.toLocaleString('en-IN')}</div>
              </div>
            </div>
          </section>

          <section className="credits-ledger">
            <div className="credits-ledger-header">
              <h2 className="credits-ledger-title">
                <Award size={20} color="var(--gold, #ffb703)" />
                Credit Ledger
              </h2>

              <div className="credits-filter-group">
                {['all', 'available', 'used'].map(f => (
                  <button 
                    key={f}
                    onClick={() => setFilter(f as 'all' | 'available' | 'used')}
                    className={`credits-filter-btn ${filter === f ? 'credits-filter-btn--active' : ''}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredCredits.length === 0 ? (
              <div className="credits-empty">
                <Gift size={48} />
                <p>
                  {filter === 'all' ? "You don't have any credits yet." : `You don't have any ${filter} credits.`}
                </p>
              </div>
            ) : (
              <div className="credits-list">
                <AnimatePresence mode="popLayout">
                  {filteredCredits.map((credit, idx) => (
                    <motion.div
                      key={credit.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.05 }}
                      className="credit-entry"
                    >
                      <div className="credit-entry__info">
                        <div className="credit-entry__title-row">
                          <strong className="credit-entry__reason">{credit.reason}</strong>
                          <span className={`credit-entry__badge credit-entry__badge--${credit.status}`}>
                            {credit.status}
                          </span>
                        </div>
                        <div className="credit-entry__meta">
                          Earned: {formatLocaleDate(credit.earnedAt, 'en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
                          {credit.status === 'used' && credit.usedMonth && credit.usedYear && (
                            <span className="credit-entry__used-info">
                              • Applied to {monthAbbreviation(credit.usedMonth)} {credit.usedYear}
                            </span>
                          )}
                        </div>
                        {credit.description && (
                          <div className="credit-entry__description">
                            {credit.description}
                          </div>
                        )}
                      </div>
                      
                      <div className="credit-entry__amount-col">
                        <div className={`credit-entry__amount credit-entry__amount--${credit.status}`}>
                          ₹{credit.amount}
                        </div>
                        <div className="credit-entry__code">
                          {credit.creditCode}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
