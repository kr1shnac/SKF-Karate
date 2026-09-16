'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Repeat } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import SecureContentWrapper from '@/app/_components/portal/SecureContentWrapper'
import YouTubeNativePlayer from '@/components/video/YouTubeNativePlayer'

type Lesson = {
  id: string
  title: string
  description: string
  lessonNote: string
  youtubeId: string
  thumbnailUrl: string
  contentFormat: 'landscape' | 'short'
}

type FolderCrumb = { id: string; title: string }

export default function DirectPracticeLesson({
  lesson,
  initialProgressPercent = 0,
  initialWatchedSeconds = 0,
  initialPracticedCount = 0,
  folderPath = [],
}: {
  lesson: Lesson
  initialProgressPercent?: number
  initialWatchedSeconds?: number
  initialPracticedCount?: number
  folderPath?: FolderCrumb[]
}) {
  const router = useRouter()
  const isShort = lesson.contentFormat === 'short'
  const [progressPercent, setProgressPercent] = useState(initialProgressPercent)
  const [practicedCount, setPracticedCount] = useState(initialPracticedCount)
  const pendingProgressRef = useRef<{ percent: number; seconds?: number } | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    document.body.classList.add('portal-practice-detail')
    document.body.classList.add('portal-practice-player')
    return () => {
      document.body.classList.remove('portal-practice-detail')
      document.body.classList.remove('portal-practice-player')
    }
  }, [])

  const flushProgress = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const value = pendingProgressRef.current
    if (!value) return
    pendingProgressRef.current = null

    const entry: { videoId: string; progressPercent: number; seconds?: number } = {
      videoId: lesson.id,
      progressPercent: value.percent,
    }
    if (typeof value.seconds === 'number') {
      entry.seconds = value.seconds
    }

    try {
      await fetch('/api/portal/videos/progress/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [entry] }),
      })
    } catch {
      // Watching a shared lesson without recording progress is acceptable.
    }
  }, [lesson.id])

  const handleProgress = useCallback(
    ({ progressPercent: nextPercent, seconds }: { progressPercent: number; seconds?: number }) => {
      const safe = Math.max(0, Math.min(100, Math.round(nextPercent)))
      setProgressPercent(safe)
      pendingProgressRef.current = { percent: safe, seconds: typeof seconds === 'number' && Number.isFinite(seconds) ? Math.floor(seconds) : undefined }
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      if (safe >= 100) {
        void flushProgress()
        return
      }
      flushTimerRef.current = setTimeout(() => {
        void flushProgress()
      }, 1500)
    },
    [flushProgress]
  )

  useEffect(() => {
    function flushOnHide() {
      if (document.visibilityState === 'hidden') {
        void flushProgress()
      }
    }
    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', flushOnHide)
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('pagehide', flushOnHide)
    }
  }, [flushProgress])

  useEffect(() => {
    return () => {
      void flushProgress()
    }
  }, [flushProgress])

  const handleEscape = useCallback(() => {
    void flushProgress()
    router.push('/portal/videos')
  }, [flushProgress, router])

  const handlePracticed = useCallback(() => {
    const nextCount = practicedCount + 1
    setPracticedCount(nextCount)
    fetch(`/api/portal/videos/progress/practice/${encodeURIComponent(lesson.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        const serverCount = Number(data?.data?.practicedCount)
        if (Number.isFinite(serverCount) && serverCount > 0) {
          setPracticedCount(serverCount)
        }
      })
      .catch(() => {
        // Optimistic count already applied; the next library load reconciles.
      })
  }, [lesson.id, practicedCount])

  return <SecureContentWrapper>
    <main style={{ minHeight: '100dvh', background: '#000', color: '#fff', padding: 'clamp(5rem, 8vw, 7rem) 4% 3rem' }}>
      <nav aria-label="Folder path" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: folderPath.length ? '1rem' : 0 }}>
        <Link href="/portal/videos" style={{ color: 'rgba(255,255,255,0.8)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontWeight: 700 }}><ChevronLeft size={22} /> Home Practice</Link>
        {folderPath.map((crumb) => (
          <Fragment key={crumb.id}>
            <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.9rem' }}>/</span>
            <Link
              href={`/portal/videos?folder=${encodeURIComponent(crumb.id)}`}
              style={{ color: 'rgba(255,255,255,0.65)', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem', transition: 'color 0.2s ease' }}
              className="practice-crumb"
            >
              {crumb.title}
            </Link>
          </Fragment>
        ))}
      </nav>
      <div style={{ width: isShort ? 'min(calc(100vw - 2rem), 33dvh)' : '100%', maxWidth: isShort ? 360 : 1120, margin: '1.5rem auto 0' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: 'clamp(1.5rem, 3vw, 2.2rem)' }}>{lesson.title}</h1>
        <div style={{ position: 'relative', width: '100%', aspectRatio: isShort ? '9 / 16' : '16 / 9', background: '#050505', borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 22px 65px rgba(0,0,0,0.5)' }}>
          <YouTubeNativePlayer
            youtubeId={lesson.youtubeId}
            title={lesson.title}
            posterUrl={lesson.thumbnailUrl}
            contentFormat={lesson.contentFormat}
            initialProgressPercent={progressPercent}
            initialSeconds={initialWatchedSeconds}
            onProgress={handleProgress}
            onEscape={handleEscape}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={handlePracticed}
            aria-label={`Practiced: ${practicedCount} times`}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', width: '100%', padding: '1rem', borderRadius: 16, background: 'linear-gradient(135deg, rgba(255,183,3,0.16), rgba(255,183,3,0.03))', border: '1px solid rgba(255,183,3,0.5)', color: '#ffb703', fontSize: '1.05rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.3s ease' }}
            className="pv-btn-practiced"
          >
            <Repeat size={20} /> Practiced <b style={{ display: 'grid', placeItems: 'center', minWidth: '1.8rem', height: '1.8rem', padding: '0 0.5rem', borderRadius: 99, background: 'rgba(255,183,3,0.22)', border: '1px solid rgba(255,183,3,0.6)', fontSize: '0.85rem' }}>{practicedCount}×</b>
          </button>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textAlign: 'center' }}>Practiced = you repeated the technique. Every tap counts toward your drill streak.</span>
        </div>
        {lesson.description ? <p style={{ color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>{lesson.description}</p> : null}
        {lesson.lessonNote ? <aside style={{ marginTop: '1rem', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', padding: '1rem 1.1rem' }}><div style={{ color: '#ffb703', fontSize: '0.7rem', fontWeight: 850, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Instructor note</div><p style={{ margin: '0.45rem 0 0', color: 'rgba(255,255,255,0.78)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{lesson.lessonNote}</p></aside> : null}
      </div>
    </main>
  </SecureContentWrapper>
}