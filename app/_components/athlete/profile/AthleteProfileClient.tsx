'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import html2canvas from 'html2canvas'
import { RankingCard } from '@/components/RankingCard'
import {
  Search, ChevronRight, Eye, Share2,
  Calendar, MapPin, Trophy, Shield, Star
} from 'lucide-react'

import '@/app/athlete-profile.css'
import '@/app/athlete-hero.css'
import '@/app/rankings/rankings.css'
import { CertificateModal } from '@/components/CertificateModal'
import { CertificateCard } from '@/components/CertificateCard'
import type { CertificateConfig } from '@/components/CertificateCard'

function formatName(name: string) {
  if (!name) return name
  // Bind single-character initials to the adjacent word to prevent dangling initials on wrap
  return name
    .replace(/\b([A-Za-z])\s+/g, '$1\u00A0')
    .replace(/\s+([A-Za-z])\b/g, '\u00A0$1')
}

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC CERTIFICATES
   ═══════════════════════════════════════════════════════════════════════ */
type PublicCertificate = Omit<CertificateConfig, 'onView'>

type CompetitionResult = {
  date: string
  event: string
  type: string
  category: string
  rank?: number | string | null
  wins?: number | string
  actual?: number
  points?: number | string
}

type CompetitionCategory = {
  name: string
  isPrimary?: boolean
  rank?: number | null
  points?: number | null
  results?: CompetitionResult[]
  honours?: Array<{
    name: string
    gold: number
    silver: number
    bronze: number
  }>
}

type AthleteInfo = {
  name: string
  photo: string
  fallbackPhoto?: string
  country: string
  countryFlag?: string
  id: string
  age: number
  totalBouts: number
  winRate: string
  branchName?: string
  branchHref?: string
  publicProfileHref?: string
  currentBelt?: string
}

type NextEvent = {
  dateRange: string
  name: string
  href?: string
  venue?: string
  city?: string
  branch?: string
}

type AthleteProfileClientProps = {
  athleteInfo: AthleteInfo
  categories?: CompetitionCategory[]
  nextEvents?: NextEvent[]
  beltExaminations?: Array<{ date: string; belt: string; grade: string; examiner: string; dojo: string; result: string }>
  specialEvents?: Array<{ date: string; title: string; type: string; location: string }>
  beltColors?: Record<string, string>
  isDashboardContext?: boolean
}

function sumHonours(categories: CompetitionCategory[], medal: 'gold' | 'silver' | 'bronze') {
  return categories.reduce(
    (sum, category) =>
      sum + (category.honours || []).reduce((inner, honour) => inner + Number(honour[medal] || 0), 0),
    0
  )
}

function PublicCertificates({ skfId, onOpenCertificate }: { skfId: string, onOpenCertificate: (id: string) => void }) {
  const [certs, setCerts] = useState<PublicCertificate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!skfId) return
    fetch(`/api/certificates/public?skfId=${skfId}`)
      .then(res => res.json())
      .then(data => setCerts(data.certificates || data.data?.certificates || []))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [skfId])

  if (loading || certs.length === 0) return null

  return (
    <section className="ap-section ap-animate-in ap-delay-3" id="verified-certificates">
      <SectionHeader icon={<Shield size={16} />} label="Verified Certificates" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {certs.map((c) => (
          <CertificateCard 
            key={c.id} 
            cert={{ ...c, onView: () => onOpenCertificate(c.id) }} 
          />
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MEDAL BADGE — colored circle for ranks 1-3
   ═══════════════════════════════════════════════════════════════════════ */
function MedalBadge({ rank }: { rank?: number | string | null }) {
  if (rank === '*' || rank === '-' || rank == null) {
    return <span className="ap-rank-plain">{rank ?? '-'}</span>
  }
  const n = typeof rank === 'number' ? rank : Number.parseInt(rank, 10)
  if (n >= 1 && n <= 3) {
    const cls = ['', 'ap-rank-gold', 'ap-rank-silver', 'ap-rank-bronze'][n]
    return <span className={`ap-rank-circle ${cls}`}>{n}</span>
  }
  return <span className="ap-rank-plain">{rank}</span>
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION HEADER — clean bold heading
   ═══════════════════════════════════════════════════════════════════════ */
function SectionHeader({ label }: { icon?: ReactNode; label: string }) {
  return (
    <h2 className="ap-sec-head">{label}</h2>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   HERO — Championship Card — One unified premium card
   ═══════════════════════════════════════════════════════════════════════ */
function AthleteHero({
  athleteInfo,
  categories = [],
  onShareCard,
  isExporting,
  isDashboardContext = false,
  beltColors = {},
}: {
  athleteInfo: AthleteInfo
  categories?: CompetitionCategory[]
  onShareCard?: () => void
  isExporting: boolean
  isDashboardContext?: boolean
  beltColors?: Record<string, string>
}) {
  const primary = categories.find((c) => c?.isPrimary) || categories[0] || { name: 'Unranked', rank: null, points: 0, honours: [] }
  const totalG = sumHonours(categories, 'gold')
  const totalS = sumHonours(categories, 'silver')
  const totalB = sumHonours(categories, 'bronze')
  const totalMedals = totalG + totalS + totalB

  const beltLabel = athleteInfo.currentBelt || 'White Belt'
  const beltColor = beltColors[beltLabel] || '#ffffff'

  return (
    <section className="ap-hero ap-animate-in">
      <div className="aph-card">
        {/* Ambient glow */}
        <div className="aph-card__ambient" />
        <div className="aph-card__ambient aph-card__ambient--bl" />

        {/* ── Header Band ── */}
        <div className="aph-header">
          <div className="aph-header__left">
            <span className="aph-header__pre">Official SKF Athlete</span>
            <h1 className="aph-header__name">{formatName(athleteInfo.name)}</h1>
            <div className="aph-header__tags">
              <div 
                className="ap-belt-chip"
                style={{ '--chip-color': beltColor, background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.1)' } as React.CSSProperties}
              >
                <span className="ap-belt-chip__swatch" style={{ background: beltColor, boxShadow: `0 0 10px ${beltColor}` }} />
                <span className="ap-belt-chip__label" style={{ color: '#fff', fontWeight: 800 }}>{beltLabel}</span>
              </div>
              {athleteInfo.branchName && (
                <Link href={athleteInfo.branchHref || '/classes'} className="aph-tag aph-tag--accent">
                  Trains at SKF {athleteInfo.branchName}
                </Link>
              )}
              {isDashboardContext && athleteInfo.publicProfileHref ? (
                <Link href={athleteInfo.publicProfileHref} target="_blank" className="aph-tag aph-tag--outline">
                  Open Public Profile
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Content: Photo + Detail ── */}
        <div className="aph-content">
          <div className="aph-photo">
            <Image
              src={athleteInfo.photo}
              alt={athleteInfo.name}
              fill
              crossOrigin="anonymous"
              style={{ objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = athleteInfo.fallbackPhoto || '/no-profile/no profile male.png'
              }}
            />
            <div className="aph-photo__fade" />
            <div className="aph-photo__id">
              <span className="aph-photo__id-sup">SKF ID</span>
              {athleteInfo.id}
            </div>
          </div>

          <div className="aph-detail">
            {/* Ranking */}
            <div className="aph-rank">
              <div className="aph-rank__glow" />
              <div className="aph-rank__body">
                <div className="aph-rank__info">
                  <span className="aph-rank__label">SKF Ranking</span>
                  <span className="aph-rank__cat">{primary.name}</span>
                {primary.points ? (
                  <span className="aph-rank__pts">{primary.points.toLocaleString('en-IN')} pts</span>
                ) : null}
                </div>
                <div className="aph-rank__num">
                  {primary.rank ? `#${primary.rank}` : '—'}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="aph-stats">
              <div className="aph-stat">
                <span className="aph-stat__val">{athleteInfo.age}</span>
                <span className="aph-stat__lbl">Age</span>
              </div>
              <div className="aph-stat">
                <span className="aph-stat__val">
                {athleteInfo.countryFlag && (
                  <Image
                    src={athleteInfo.countryFlag}
                    alt={athleteInfo.country}
                    width={24}
                    height={17}
                    unoptimized
                    crossOrigin="anonymous"
                    style={{
                      borderRadius: '3px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      display: 'inline-block',
                    }}
                  />
                )}
                {athleteInfo.country}
              </span>
                <span className="aph-stat__lbl">Country</span>
              </div>
              <div className="aph-stat">
                <span className="aph-stat__val">{athleteInfo.totalBouts}</span>
                <span className="aph-stat__lbl">Bouts</span>
              </div>
              <div className="aph-stat">
                <span className="aph-stat__val">{athleteInfo.winRate}</span>
                <span className="aph-stat__lbl">Win Rate</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer: Medals + Share ── */}
        <div className="aph-footer">
          <div className="aph-tally">
            <div className="aph-coin aph-coin--gold">
              <div className="aph-coin__face">{totalG}</div>
              <span>Gold</span>
            </div>
            <div className="aph-coin aph-coin--silver">
              <div className="aph-coin__face">{totalS}</div>
              <span>Silver</span>
            </div>
            <div className="aph-coin aph-coin--bronze">
              <div className="aph-coin__face">{totalB}</div>
              <span>Bronze</span>
            </div>
            <div className="aph-tally__sep" />
            <div className="aph-tally__total">
              <span className="aph-tally__num">{totalMedals}</span>
              <span>Total</span>
            </div>
          </div>
          {onShareCard && (
            <button onClick={onShareCard} disabled={isExporting} className="aph-share" title="Share Ranking Card">
              <Share2 size={16} />
              <span>{isExporting ? 'Generating…' : 'Share Ranking Card'}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   NEXT EVENTS
   ═══════════════════════════════════════════════════════════════════════ */
function NextEventsSection({ nextEvents }: { nextEvents: NextEvent[] }) {
  if (!nextEvents || nextEvents.length === 0) return null

  return (
    <section className="ap-section ap-animate-in ap-delay-1">
      <SectionHeader icon={<Calendar size={16} />} label="Athlete's Next Events" />
      <div className="ap-next-events">
        {nextEvents.map((ev) => (
          <Link
            key={`${ev.dateRange}-${ev.name}`}
            href={ev.href || '/events'}
            className="ap-next-ev"
          >
            <div className="ap-next-ev__content">
              <span className="ap-next-ev__date">{ev.dateRange}</span>
              <span className="ap-next-ev__name">
                {ev.name}{ev.branch ? ` — ${ev.branch}` : ev.venue ? ` — ${ev.venue}` : ''}{ev.city ? ` (${ev.city})` : ''}
              </span>
            </div>
            <ChevronRight size={16} className="ap-next-ev__arrow" />
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   TABBED COMPETITION RESULTS — sorted descending
   ═══════════════════════════════════════════════════════════════════════ */
function TabbedCompetitions({ categories }: { categories: CompetitionCategory[]; isDashboardContext?: boolean }) {
  const [activeTab, setActiveTab] = useState(0)
  const [filter, setFilter] = useState('')

  // Sort: ranked categories first (ascending), then unranked alphabetically
  const sortedCategories = useMemo(() => {
    const ranked = categories.filter((c): c is CompetitionCategory & { rank: number } => c.rank != null).sort((a, b) => a.rank - b.rank)
    const unranked = categories.filter((c) => !c.rank).sort((a, b) => a.name.localeCompare(b.name))
    return [...ranked, ...unranked]
  }, [categories])

  const cat = sortedCategories[activeTab]

  const hasAnyResults = sortedCategories.some((c) => c.results && c.results.length > 0)
  const filtered = useMemo(() => {
    if (!cat?.results) return []
    let rows = [...cat.results].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    if (filter.trim()) {
      const q = filter.toLowerCase()
      rows = rows.filter((r) => r.event.toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q) || (r.date || '').includes(q))
    }
    return rows
  }, [cat, filter])

  if (!sortedCategories || sortedCategories.length === 0 || !hasAnyResults) return null

  return (
    <section id="ap-competition-section" className="ap-section ap-animate-in ap-delay-2">
      <SectionHeader icon={<Trophy size={16} />} label="Competition Results" />
      <div className="ap-panel">
        {/* Tabs */}
        <div className="lb-tabs" style={{ marginBottom: '1.5rem', justifyContent: 'flex-start', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {sortedCategories.map((c, i) => (
            <button key={c.name} type="button" className={`lb-tab ${activeTab === i ? 'lb-tab--on' : ''}`}
              onClick={() => { setActiveTab(i); setFilter('') }}>
              {c.name}
              {c.rank ? <span className="ap-tab__badge" style={{ marginLeft: '4px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7em' }}>#{c.rank}</span> : null}
            </button>
          ))}
        </div>

        {/* Category overview */}
        <div className="ap-cat-overview">
          <h3 className="ap-cat-overview__title">{cat.name}</h3>
          <div className="ap-cat-overview__rank">
            {cat.rank ? (
              <span className="ap-cat-overview__rank-circle">{cat.rank}</span>
            ) : (
              <span className="ap-cat-overview__rank-circle ap-cat-overview__rank-circle--unranked">–</span>
            )}
            <span className="ap-cat-overview__rank-label">RANK</span>
            <span className="ap-cat-overview__rank-pts">
              {cat.points ? `${cat.points.toLocaleString('en-IN')} points` : ''}
            </span>
          </div>

          {/* Honours */}
          {cat.honours && cat.honours.length > 0 && (
            <>
              <h4 className="ap-cat-overview__hon-title">Honours</h4>
              <div className="ap-hon-list">
                {[...cat.honours]
                  .sort((a, b) => (b.gold + b.silver + b.bronze) - (a.gold + a.silver + a.bronze))
                  .map((h) => (
                    <div key={h.name} className="ap-hon-row">
                      <div className="ap-hon-row__medals">
                        <span className="ap-hon-dot ap-hon-dot--g">{h.gold}</span>
                        <span className="ap-hon-dot ap-hon-dot--s">{h.silver}</span>
                        <span className="ap-hon-dot ap-hon-dot--b">{h.bronze}</span>
                      </div>
                      <span className="ap-hon-row__name">{h.name}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* Filter */}
        <div className="ap-filter">
          <input type="text" placeholder="Filter events…" value={filter}
            onChange={(e) => setFilter(e.target.value)} className="ap-filter__input" />
          <Search size={16} className="ap-filter__icon" />
        </div>

        {/* Table — columns: Date, Event, Type, Category, Rank, Wins, Points */}
        <div className="ap-tbl-wrap">
          <table className="ap-tbl">
            <thead>
              <tr>
                <th style={{ width: '12%' }}>Date</th>
                <th style={{ width: '30%' }}>Event</th>
                <th style={{ width: '16%' }}>Type</th>
                <th style={{ width: '14%' }}>Category</th>
                <th className="ctr" style={{ width: '10%' }}>Rank</th>
                <th className="ctr" style={{ width: '8%' }}>Wins</th>
                <th className="ctr" style={{ width: '10%' }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.date}-${r.event}`}>
                  <td className="ap-tbl__date">{r.date}</td>
                  <td>
                    <span className="ap-tbl__ev">{r.event}</span>
                  </td>
                  <td>{r.type}</td>
                  <td>{r.category}</td>
                  <td className="ctr"><MedalBadge rank={r.rank} /></td>
                  <td className="ctr">{r.wins}</td>
                  <td className={`ctr ${(r.actual ?? 0) > 0 ? 'ap-tbl__gold-text' : ''}`}>{r.points}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="ap-tbl__empty ctr">No results found for &ldquo;{filter}&rdquo;</td>
                </tr>
              )}
            </tbody>
            {cat.points ? (
            <tfoot>
              <tr className="ap-tbl__foot">
                <td colSpan={7}>Total Points: <strong className="ap-tbl__accent">{cat.points.toLocaleString()}</strong></td>
              </tr>
            </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   BELT JOURNEY — table with View column (portal only), sorted descending
   ═══════════════════════════════════════════════════════════════════════ */
function BeltJourney({ beltExaminations, beltColors }: { beltExaminations: { date: string; belt: string; grade: string; examiner: string; dojo: string; result: string }[]; beltColors: Record<string, string> }) {
  if (!beltExaminations || beltExaminations.length === 0) return null
  const sorted = [...beltExaminations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <section className="ap-section ap-animate-in ap-delay-3" id="certifications">
      <SectionHeader icon={<Shield size={16} />} label="Certifications & Belt Progression" />
      <div className="ap-panel">
        <div className="ap-tbl-wrap">
          <table className="ap-tbl">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Belt</th>
                <th className="ctr">Grade</th>
                <th>Examiner</th>
                <th>Dojo</th>
                <th className="ctr">Result</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ex) => {
                const col = beltColors[ex.belt] || '#ccc'
                return (
                  <tr key={`${ex.date}-${ex.grade}`}>
                    <td className="ap-tbl__date">{ex.date}</td>
                    <td>
                      <div
                          className="ap-belt-chip"
                          style={{ '--chip-color': col } as React.CSSProperties}
                      >
                          <span className="ap-belt-chip__swatch" style={{ background: col }} />
                          <span className="ap-belt-chip__label">{ex.belt}</span>
                      </div>
                    </td>
                    <td className="ctr" style={{ color: 'var(--gold)', fontWeight: 700 }}>{ex.grade}</td>
                    <td>{ex.examiner}</td>
                    <td>{ex.dojo}</td>
                    <td className="ctr">
                      <span className={`ap-pill ${ex.result === 'Pass' ? 'ap-pill--pass' : 'ap-pill--fail'}`}>{ex.result}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SPECIAL EVENTS — compact table, View column portal-only
   ═══════════════════════════════════════════════════════════════════════ */
function SpecialEventsSection({ specialEvents, isDashboardContext = false }: { specialEvents: { date: string; title: string; type: string; location: string }[]; isDashboardContext?: boolean }) {
  if (!specialEvents || specialEvents.length === 0) return null
  const sorted = [...specialEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const typeColor: Record<string, string> = { Seminar: '#ffe49a', 'Training Camp': '#99f6e4', Workshop: '#bfdbfe' }
  const typeBg: Record<string, string> = { Seminar: 'rgba(255,183,3,0.1)', 'Training Camp': 'rgba(45,212,191,0.08)', Workshop: 'rgba(59,130,246,0.08)' }
  const typeBorder: Record<string, string> = { Seminar: 'rgba(255,183,3,0.2)', 'Training Camp': 'rgba(45,212,191,0.18)', Workshop: 'rgba(59,130,246,0.18)' }

  return (
    <section className="ap-section ap-animate-in ap-delay-4">
      <SectionHeader icon={<Star size={16} />} label="Special Events & Training" />
      <div className="ap-panel">
        <div className="ap-tbl-wrap">
          <table className="ap-tbl">
            <thead>
              <tr>
                <th style={{ width: isDashboardContext ? '12%' : '15%' }}>Date</th>
                <th style={{ width: isDashboardContext ? '15%' : 'auto' }}>Type</th>
                <th style={{ width: isDashboardContext ? '38%' : 'auto' }}>Event</th>
                <th style={{ width: isDashboardContext ? '28%' : 'auto' }}>Location</th>
                {isDashboardContext && <th className="ctr" style={{ width: '7%' }}>View</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((ev) => (
                <tr key={`${ev.date}-${ev.title}`}>
                  <td className="ap-tbl__date">{ev.date}</td>
                  <td>
                    <span className="ap-type-tag" style={{
                      color: typeColor[ev.type] || '#bfdbfe',
                      background: typeBg[ev.type] || 'rgba(59,130,246,0.08)',
                      borderColor: typeBorder[ev.type] || 'rgba(59,130,246,0.18)',
                    }}>
                      {ev.type}
                    </span>
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.88)', fontWeight: 600 }}>{ev.title}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'rgba(255,255,255,0.5)' }}>
                      <MapPin size={13} /> {ev.location}
                    </span>
                  </td>
                  {isDashboardContext && <td className="ctr"><Eye size={15} className="ap-eye" aria-label="View details" /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN EXPORT
   ═══════════════════════════════════════════════════════════════════════ */
export default function AthleteProfileClient({
  athleteInfo, categories = [], nextEvents = [], beltExaminations = [], specialEvents = [], beltColors = {}, isDashboardContext = false
}: AthleteProfileClientProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(null)
  
  const cardRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const totalG = sumHonours(categories, 'gold')
  const totalS = sumHonours(categories, 'silver')
  const totalB = sumHonours(categories, 'bronze')

  const handleShareCard = async () => {
    if (!cardRef.current) return
    setIsExporting(true)
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#05080f'
      })
      const url = canvas.toDataURL('image/jpeg', 0.9)
      const a = document.createElement('a')
      a.href = url
      a.download = `SKF_Rank_${athleteInfo.name.replace(/\s+/g, '_')}.jpg`
      a.click()
    } catch {
      alert("Failed to generate the ranking card. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }

  const handleOpenCertificate = (id: string) => {
    setSelectedEnrollmentId(id)
    setModalOpen(true)
  }

  // To match the new tabbed layout spec without destroying the whole page,
  // we are introducing page-level native smooth-scroll anchors below the hero.
  
  return (
    <div className={`ap-page ${isDashboardContext ? 'kuroobi-dashboard' : ''}`} style={isDashboardContext ? { background: 'transparent', minHeight: 'auto' } : {}}>


      <div className="ap-container">
        <AthleteHero
          athleteInfo={athleteInfo}
          categories={categories}
          onShareCard={!isDashboardContext ? handleShareCard : undefined}
          isExporting={isExporting}
          isDashboardContext={isDashboardContext}
          beltColors={beltColors}
        />

        <NextEventsSection nextEvents={nextEvents} />
        <TabbedCompetitions categories={categories} isDashboardContext={isDashboardContext} />
        {isDashboardContext && <PublicCertificates skfId={athleteInfo.id} onOpenCertificate={handleOpenCertificate} />}
        <BeltJourney beltExaminations={beltExaminations} beltColors={beltColors} />
        <SpecialEventsSection specialEvents={specialEvents} isDashboardContext={isDashboardContext} />
      </div>

      <CertificateModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        enrollmentId={selectedEnrollmentId || ''}
        skfId={athleteInfo.id}
      />
      
      <RankingCard 
        ref={cardRef} 
        athleteInfo={athleteInfo} 
        categories={categories} 
        totalG={totalG} 
        totalS={totalS} 
        totalB={totalB} 
      />

      <div style={{ height: 'calc(7rem + env(safe-area-inset-bottom))' }} />
    </div>
  )
}
