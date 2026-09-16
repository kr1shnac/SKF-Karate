'use client'
/* eslint-disable @next/next/no-img-element -- protected Supabase images use short-lived signed URLs. */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Play,
  PlayCircle,
  Repeat,
  Search,
  Sparkles,
} from 'lucide-react'

import SecureContentWrapper from '@/app/_components/portal/SecureContentWrapper'
import PortalNoticePopup from '@/app/_components/portal/PortalNoticePopup'
import YouTubeNativePlayer from '@/components/video/YouTubeNativePlayer'
import YouTubeThumbnail from '@/components/video/YouTubeThumbnail'
import { VideosPageSkeleton } from '../_components/skeletons/VideosPageSkeleton'
import { useNonce } from '@/components/NonceProvider'
import { redirectToCurrentPortalLogin } from '@/app/_components/portal/portalClientRedirect'

/**
 * Home Practice Library — "Dojo Stream" shell.
 * Every rule below exists to keep the library reading like a premium
 * streaming surface (uniform tiles, snap rails, viewport-fit player)
 * while matching the Kuroobi portal theme: pure-black base, amber
 * ambient signature, glass shelves, Outfit headings.
 */
function normalizeVideo(video) {
  return {
    ...video,
    id: String(video.id || video.youtubeId || video.title || ''),
    title: video.title || 'Untitled Training Video',
    duration: video.durationLabel || video.duration || '',
    category: String(video.category || 'techniques').toLowerCase(),
    locked: Boolean(video.locked),
    youtubeId: video.youtubeId,
    thumbnail: video.thumbnailUrl,
    contentFormat: video.contentFormat === 'short' ? 'short' : 'landscape',
  }
}

function formatCategoryLabel(value) {
  return String(value || 'Training')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normaliseLibraryPayload(payload) {
  return {
    folders: (payload?.folders || []).map((folder) => ({
      ...folder,
      id: String(folder.id || ''),
      title: folder.title || 'Home Practice',
      videos: (folder.videos || []).map(normalizeVideo).filter((video) => video.id && video.youtubeId),
      photos: (folder.photos || []).filter((photo) => photo.id && photo.imageUrl),
    })).filter((folder) => folder.id),
    unfiledVideos: (payload?.unfiledVideos || []).map(normalizeVideo).filter((video) => video.id && video.youtubeId),
    unfiledPhotos: (payload?.unfiledPhotos || []).filter((photo) => photo.id && photo.imageUrl),
    progressData: payload?.progressData || [],
    recentCutoff: String(payload?.recentlyAddedCutoff || ''),
  }
}

const SHELF_EASE = [0.16, 1, 0.3, 1]

export default function VideosClient({ initialPayload = null }) {
  const nonce = useNonce()
  const initialLibrary = useMemo(() => initialPayload ? normaliseLibraryPayload(initialPayload) : null, [initialPayload])
  const [folders, setFolders] = useState(() => initialLibrary?.folders || [])
  const [unfiledVideos, setUnfiledVideos] = useState(() => initialLibrary?.unfiledVideos || [])
  const [unfiledPhotos, setUnfiledPhotos] = useState(() => initialLibrary?.unfiledPhotos || [])
  const [progressData, setProgressData] = useState(() => initialLibrary?.progressData || [])
  const [recentCutoff, setRecentCutoff] = useState(() => initialLibrary?.recentCutoff || '')
  const [recommendedVideoId, setRecommendedVideoId] = useState(() => String(initialPayload?.recommendedVideoId || ''))
  const [recommendationReason, setRecommendationReason] = useState(() => String(initialPayload?.recommendationReason || ''))
  const [isLoading, setIsLoading] = useState(() => !initialLibrary)
  const [error, setError] = useState('')
  const [playingVideo, setPlayingVideo] = useState(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [activeFolder, setActiveFolder] = useState(null)
  const [deepLinkResolved, setDeepLinkResolved] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const dismissedAt = localStorage.getItem('skf-student-banner-dismissed-at')
      if (!dismissedAt) return false
      const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24)
      return daysSince < 3 // hidden for 3 days after dismiss
    } catch { return false }
  })
  function dismissBanner() {
    setBannerDismissed(true)
    try { localStorage.setItem('skf-student-banner-dismissed-at', String(Date.now())) } catch {}
  }
  const viewerScrollRef = useRef(null)

  // Scroll/navigation memory: captures where the athlete was before opening a
  // folder or the player so closing them returns to the same place instead of
  // throwing the page back to the top.
  const pendingScrollRef = useRef(null)
  const foldersRef = useRef(folders)

  useEffect(() => {
    foldersRef.current = folders
  }, [folders])

  const pendingProgressRef = useRef(new Map())
  const progressFlushTimerRef = useRef(null)

  const flushPendingProgress = useCallback(async () => {
    if (progressFlushTimerRef.current) {
      clearTimeout(progressFlushTimerRef.current)
      progressFlushTimerRef.current = null
    }

    const pending = pendingProgressRef.current
    if (!pending.size) return

    const entries = [...pending.values()]
    pending.clear()

    const chunks = []
    for (let index = 0; index < entries.length; index += 20) {
      chunks.push(entries.slice(index, index + 20))
    }

    try {
      await Promise.all(
        chunks.map((batchEntries) =>
          fetch('/api/portal/videos/progress/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: batchEntries }),
          })
        )
      )
    } catch {
      // Local progress already reflects the change
    }
  }, [])

  const scheduleProgressFlush = useCallback(
    (options = {}) => {
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current)
        progressFlushTimerRef.current = null
      }
      if (options.immediate) {
        void flushPendingProgress()
        return
      }
      progressFlushTimerRef.current = setTimeout(() => {
        void flushPendingProgress()
      }, 1500)
    },
    [flushPendingProgress]
  )

  useEffect(() => {
    return () => {
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current)
        progressFlushTimerRef.current = null
      }
      void flushPendingProgress()
    }
  }, [flushPendingProgress])

  useEffect(() => {
    // The debounce timer may never fire if the athlete closes/backgrounds the
    // tab mid-practice, losing the exact resume position. Flush immediately
    // whenever the page drops out of view.
    function flushOnHide() {
      if (document.visibilityState === 'hidden') {
        void flushPendingProgress()
      }
    }
    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', flushOnHide)
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('pagehide', flushOnHide)
    }
  }, [flushPendingProgress])

  useEffect(() => {
    // Server-rendered payload is already fresh on the first paint; only hit the
    // API when the page rendered without one (auth failure / transient SSR error).
    if (initialPayload) return
    let cancelled = false

    async function fetchPortalVideos() {
      setIsLoading(true)
      setError('')

      try {
        const videosRes = await fetch('/api/portal/videos', { cache: 'no-store' })

        if (videosRes.status === 401) {
          redirectToCurrentPortalLogin()
          return
        }

        if (!videosRes.ok) throw new Error('Unable to load training videos.')

        const videosPayload = await videosRes.json()
        const payload = videosPayload?.data && typeof videosPayload.data === 'object'
          ? videosPayload.data
          : videosPayload

        if (!cancelled) {
          const nextLibrary = normaliseLibraryPayload(payload)
          setFolders(nextLibrary.folders)
          setUnfiledVideos(nextLibrary.unfiledVideos)
          setUnfiledPhotos(nextLibrary.unfiledPhotos)
          setProgressData(nextLibrary.progressData)
          setRecentCutoff(nextLibrary.recentCutoff)
          setRecommendedVideoId(String(payload.recommendedVideoId || ''))
          setRecommendationReason(String(payload.recommendationReason || ''))
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load training videos.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchPortalVideos()
    return () => {
      cancelled = true
    }
  }, [initialPayload])

  useEffect(() => {
    if (!playingVideo) {
      document.body.style.overflow = ''
      return
    }

    // Lock the page behind the player only while the player's own column has
    // something to scroll. On large screens where a lesson fits entirely the
    // page stays scrollable, so the mouse wheel never hits a dead zone.
    let frame = 0
    const syncBodyLock = () => {
      const viewer = viewerScrollRef.current
      const scrollable = Boolean(viewer && viewer.scrollHeight > viewer.clientHeight + 1)
      document.body.style.overflow = scrollable ? 'hidden' : ''
    }
    frame = window.requestAnimationFrame(() => window.requestAnimationFrame(syncBodyLock))
    window.addEventListener('resize', syncBodyLock)
    window.addEventListener('orientationchange', syncBodyLock)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', syncBodyLock)
      window.removeEventListener('orientationchange', syncBodyLock)
      document.body.style.overflow = ''
    }
  }, [playingVideo])

  useEffect(() => {
    const isInsidePracticeDetail = Boolean(activeFolder || playingVideo)
    document.body.classList.toggle('portal-practice-detail', isInsidePracticeDetail)
    document.body.classList.toggle('portal-practice-player', Boolean(playingVideo))
    return () => {
      document.body.classList.remove('portal-practice-detail')
      document.body.classList.remove('portal-practice-player')
    }
  }, [activeFolder, playingVideo])

  useEffect(() => {
    if (!playingVideo) return
    const frame = window.requestAnimationFrame(() => viewerScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' }))
    return () => window.cancelAnimationFrame(frame)
  }, [playingVideo])

  useLayoutEffect(() => {
    if (playingVideo) return
    const restoreY = pendingScrollRef.current
    if (restoreY !== null) {
      pendingScrollRef.current = null
      window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' })
    }
  }, [playingVideo])

  useLayoutEffect(() => {
    // Closing a folder (or landing back on the home library) returns the
    // athlete to where they were; drilling into a folder starts from the top.
    const restoreY = pendingScrollRef.current
    pendingScrollRef.current = null
    if (restoreY !== null && !activeFolder?.id) {
      window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' })
      return
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [activeFolder?.id])

  // Mirror folder navigation into a shallow ?folder=<id> URL so the browser
  // Back button and a page refresh both restore the athlete's position.
  useEffect(() => {
    function handlePopState() {
      const folderId = window.history.state?.folderId
      if (!folderId) {
        setActiveFolder(null)
        return
      }
      const folder = foldersRef.current.find((f) => String(f.id) === String(folderId))
      setActiveFolder(folder || null)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Resolve a ?folder=<id> deep link exactly once via the documented "adjust
  // state during render" pattern (guarded by a flag, not a ref), so the folder
  // opens on first client render without an effect round-trip.
  if (!deepLinkResolved && folders.length) {
    setDeepLinkResolved(true)
    const folderId = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('folder')
      : null
    if (folderId) {
      const folder = folders.find((f) => String(f.id) === String(folderId))
      if (folder) setActiveFolder(folder)
    }
  }

  const progressByVideoId = useMemo(() => {
    return new Map(progressData.map((entry) => [String(entry.videoId), entry]))
  }, [progressData])

  const videos = useMemo(() => [...folders.flatMap((folder) => folder.videos), ...unfiledVideos], [folders, unfiledVideos])
  const hasContent = Boolean(videos.length || folders.some((folder) => folder.photos?.length) || unfiledPhotos.length)

  const keepDrilling = useMemo(() => {
    return videos
      .map((video) => ({ ...video, progress: progressByVideoId.get(video.id) }))
      .filter((video) => {
        const percent = Number(video.progress?.progressPercent || 0)
        const counted = Number(video.progress?.practicedCount || 0)
        // In-progress lessons belong here, plus anything deliberately drilled —
        // even if a kid "watched 30% and practiced it 4 times", that's a drill.
        return percent < 100 && (percent > 0 || counted > 0)
      })
      .sort((a, b) => {
        // Least-drilled first: repetition is the point, so the rail steers
        // toward whatever still needs reps rather than the latest binge.
        const ac = Number(a.progress?.practicedCount || 0)
        const bc = Number(b.progress?.practicedCount || 0)
        if (ac !== bc) return ac - bc
        return new Date(b.progress?.lastPracticedAt || b.progress?.lastWatchedAt || 0).getTime() - new Date(a.progress?.lastPracticedAt || a.progress?.lastWatchedAt || 0).getTime()
      })
  }, [progressByVideoId, videos])

  const serverRecommendedVideo = useMemo(() => {
    if (!recommendedVideoId) return null
    return videos.find((video) => String(video.id) === recommendedVideoId) || null
  }, [recommendedVideoId, videos])

  const recommendedVideo = useMemo(() => {
    // Server-computed pick (belt fit + recency + series continuation) is the
    // hero source when available; fall back to the newest unwatched lesson.
    if (serverRecommendedVideo) return serverRecommendedVideo
    const unwatched = videos.filter((video) => {
      const progress = progressByVideoId.get(video.id)
      return !progress || Number(progress.progressPercent) === 0
    })
    unwatched.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return unwatched.length > 0 ? unwatched[0] : null
  }, [serverRecommendedVideo, videos, progressByVideoId])

  const searchedLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()
    if (!query) return { folders, unfiledVideos, unfiledPhotos }
    const matches = (value) => String(value || '').toLowerCase().includes(query)
    const matchingFolders = folders.filter((folder) => (
      matches(folder.title) || matches(folder.description) || folder.videos.some((video) => (
        matches(video.title) || matches(video.description) || matches(video.category)
      )) || folder.photos.some((photo) => matches(photo.title) || matches(photo.description))
    ))
    return {
      folders: matchingFolders,
      unfiledVideos: unfiledVideos.filter((video) => matches(video.title) || matches(video.description) || matches(video.category)),
      unfiledPhotos: unfiledPhotos.filter((photo) => matches(photo.title) || matches(photo.description)),
    }
  }, [folders, libraryQuery, unfiledPhotos, unfiledVideos])

  function saveProgress(videoId, progressPercent, seconds) {
    const safeProgress = Math.max(0, Math.min(100, Math.round(progressPercent)))
    setProgressData((current) => {
      const existing = current.find((entry) => String(entry.videoId) === String(videoId))
      const nextEntry = {
        ...(existing || { videoId }),
        progressPercent: safeProgress,
        completed: safeProgress >= 100,
        lastWatchedAt: new Date().toISOString(),
      }
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        nextEntry.watchedSeconds = Math.max(0, Math.floor(seconds))
      }
      return existing
        ? current.map((entry) => String(entry.videoId) === String(videoId) ? nextEntry : entry)
        : [nextEntry, ...current]
    })

    const pendingEntry = { videoId, progressPercent: safeProgress }
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      pendingEntry.seconds = Math.max(0, Math.floor(seconds))
    }
    pendingProgressRef.current.set(String(videoId), pendingEntry)
    scheduleProgressFlush({ immediate: safeProgress >= 100 })
  }

  function recordPracticed(video) {
    const videoId = String(video.id)
    if (!videoId) return

    const nextCount = Number(progressByVideoId.get(videoId)?.practicedCount || 0) + 1
    setProgressData((current) => {
      const existing = current.find((entry) => String(entry.videoId) === String(videoId))
      const nextEntry = {
        ...(existing || { videoId }),
        practicedCount: nextCount,
        lastPracticedAt: new Date().toISOString(),
      }
      return existing
        ? current.map((entry) => String(entry.videoId) === String(videoId) ? nextEntry : entry)
        : [nextEntry, ...current]
    })

    fetch(`/api/portal/videos/progress/practice/${encodeURIComponent(videoId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        const serverCount = Number(data?.data?.practicedCount)
        if (Number.isFinite(serverCount) && serverCount > 0) {
          // Server is the single source of truth for the counter so a double-tap
          // can never over-count even though the tap is optimistically instant.
          setProgressData((current) => {
            const existing = current.find((entry) => String(entry.videoId) === String(videoId))
            if (!existing) return current
            const merged = { ...existing, practicedCount: serverCount, lastPracticedAt: new Date().toISOString() }
            return current.map((entry) => String(entry.videoId) === String(videoId) ? merged : entry)
          })
        }
      })
      .catch(() => {
        // Optimistic count already applied; the next library load reconciles.
      })
  }

  function toggleCompletion(video) {
    const current = Number(progressByVideoId.get(video.id)?.progressPercent || 0)
    void saveProgress(video.id, current >= 100 ? 0 : 100)
  }

  // Folder navigation is mirrored into a shallow ?folder=<id> URL. Drilling
  // into a folder pushes a history entry so the browser Back button walks up
  // the folder trail; jumping back up (crumb / home) replaces the entry so
  // "Back" from the library root leaves the page instead of re-opening a
  // folder. A refresh restores the exact folder via the initial ?folder= read.
  function syncFolderUrl(folderId, mode = 'push') {
    if (typeof window === 'undefined') return
    const nextUrl = folderId ? `/portal/videos?folder=${encodeURIComponent(folderId)}` : '/portal/videos'
    const state = { folderId: folderId || null }
    if (mode === 'replace') {
      window.history.replaceState(state, '', nextUrl)
    } else {
      window.history.pushState(state, '', nextUrl)
    }
  }

  function openVideo(video) {
    pendingScrollRef.current = window.scrollY
    setPlayingVideo(video)
  }

  function isFolderAncestorOfActive(folder) {
    if (!activeFolder) return false
    const visited = new Set()
    let current = activeFolder
    while (current) {
      if (current.id === folder.id) return true
      if (!current.parentFolderId || visited.has(current.id)) break
      visited.add(current.id)
      current = folders.find((f) => f.id === current.parentFolderId) || null
    }
    return false
  }

  function handleOpenFolder(folder) {
    pendingScrollRef.current = window.scrollY
    const goingUp = isFolderAncestorOfActive(folder)
    setActiveFolder(folder)
    syncFolderUrl(folder.id, goingUp ? 'replace' : 'push')
  }

  function handleCloseFolder() {
    setActiveFolder(null)
    syncFolderUrl(null, 'replace')
  }

  function closePlayerToLibrary() {
    setPlayingVideo(null)
    setIsVideoPlaying(false)
  }

  // Calculate breadcrumbs for active folder view
  const folderBreadcrumbs = useMemo(() => {
    if (!activeFolder) return []
    const crumbs = []
    let curr = activeFolder
    while (curr) {
      crumbs.unshift(curr)
      curr = folders.find((f) => f.id === curr.parentFolderId)
    }
    return crumbs
  }, [activeFolder, folders])

  const rootFolders = useMemo(() => {
    const availableIds = new Set(searchedLibrary.folders.map((folder) => folder.id))
    return searchedLibrary.folders.filter((folder) => !folder.parentFolderId || !availableIds.has(folder.parentFolderId))
  }, [searchedLibrary.folders])

  const childFolders = useMemo(() => activeFolder
    ? folders.filter((folder) => folder.parentFolderId === activeFolder.id)
    : [], [activeFolder, folders])

  const activeFolderCompleted = activeFolder
    ? activeFolder.videos.filter((video) => Number(progressByVideoId.get(video.id)?.progressPercent || 0) >= 100).length
    : 0

  const featured = useMemo(() => {
    return recommendedVideo || (keepDrilling.length > 0 ? keepDrilling[0] : (videos.length > 0 ? videos[0] : null))
  }, [recommendedVideo, keepDrilling, videos])

  const recentCutoffTime = useMemo(() => {
    const time = new Date(recentCutoff || '').getTime()
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
  }, [recentCutoff])

  const newVideoIdSet = useMemo(() => {
    const set = new Set()
    if (!Number.isFinite(recentCutoffTime)) return set
    for (const video of videos) {
      const created = new Date(video.createdAt || 0).getTime()
      if (Number.isFinite(created) && created >= recentCutoffTime) {
        const progress = progressByVideoId.get(video.id)
        // If there's any progress record (even if marked as incomplete/0%), it's been seen.
        if (!progress) {
          set.add(video.id)
        }
      }
    }
    return set
  }, [recentCutoffTime, videos, progressByVideoId])

  const newReleases = useMemo(() => {
    const releases = videos.filter((video) => newVideoIdSet.has(video.id))
    releases.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return releases
  }, [newVideoIdSet, videos])

  return (
    <SecureContentWrapper>
      <PortalNoticePopup />

      <MotionConfig reducedMotion="user">
      {isLoading ? (
        <VideosPageSkeleton />
      ) : (
      <div className="pv-root">

        {/* Amber ambient signature — the practice-library variant of the portal aura */}
        <div className="pv-aura" aria-hidden="true" />
        <div className="pv-aura-side" aria-hidden="true" />
        <div className="pv-aura-deep" aria-hidden="true" />

        {!activeFolder ? (
          <>
            <header className="pv-cinematic-header">
              <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="pv-floating-search">
              <Search size={18} className="pv-searchicon" />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search..."
                aria-label="Search practice library"
                className="pv-search"
              />
              {libraryQuery ? (
                <button type="button" onClick={() => setLibraryQuery('')} className="pv-clear pv-tap pv-focus">
                  Clear
                </button>
              ) : null}
            </motion.div>
            </header>

            {!error && hasContent && !libraryQuery ? (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }} className={`pv-hero-banner ${featured?.id === recommendedVideo?.id ? 'pv-hero-banner--recommended' : ''}`}>
                {(() => {
                  if (!featured) return null

                  return (
                    <div className="pv-hero-glass">
                      <div className="pv-hero-bg">
                        <YouTubeThumbnail youtubeId={featured.youtubeId} alt="" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
                      </div>
                      <div className="pv-hero-scrim" />
                      
                      <div className="pv-hero-content-wrapper">
                        <div className="pv-hero-content">
                          {featured.id === recommendedVideo?.id ? (
                          <div className="pv-hero-top-tag">
                            <Sparkles size={13} strokeWidth={3} /> SKF RECOMMENDS
                          </div>
                        ) : keepDrilling.length > 0 && featured.id === keepDrilling[0].id ? (
                          <div className="pv-hero-top-tag" style={{ color: 'var(--pv-jade)' }}>
                            <Repeat size={13} strokeWidth={3} /> {Number(progressByVideoId.get(featured.id)?.practicedCount || 0) > 0 ? `Keep Drilling • ${Number(progressByVideoId.get(featured.id)?.practicedCount || 0)}×` : `Resume • ${Math.round(progressByVideoId.get(featured.id)?.progressPercent || 0)}%`}
                          </div>
                        ) : null}
                        <h1 className="pv-hero-title">{featured.title}</h1>

                        {featured.id === serverRecommendedVideo?.id && recommendationReason && recommendationReason !== 'Recommended for you' ? (
                          <div className="pv-hero-reason">{recommendationReason}</div>
                        ) : null}

                        {featured.description && (
                          <p className="pv-hero-desc">{featured.description}</p>
                        )}
                        
                        <div className="pv-hero-actions">
                          <button 
                            type="button" 
                            className="pv-hero-play pv-tap pv-focus"
                            onClick={() => openVideo(featured)}
                          >
                            <Play fill="currentColor" size={20} />
                            Play Now
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  )
                })()}
              </motion.div>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div className="pv-alertwrap">
            <div role="alert" className="pv-alertbox">
              {error}
            </div>
          </div>
        ) : !hasContent ? (
          <div className="pv-empty">
            <div className="pv-empty-panel">
              <div className="pv-empty-ic"><Lock size={36} /></div>
              <h2 className="pv-empty-title">Nothing to Practice Yet</h2>
              <p className="pv-empty-text">Your branch is still building its drill library. Ask your instructor to unlock practice videos for your class.</p>
            </div>
          </div>
        ) : (
          <main className="pv-shell">
            {activeFolder ? (
              <section className="pv-folderview">
                <div className="pv-fhead">
                  {/* Breadcrumbs */}
                  <nav className="pv-crumbs" aria-label="Folder path">
                    <button
                      type="button"
                      onClick={handleCloseFolder}
                      className="pv-crumb pv-crumb--home pv-tap pv-focus"
                    >
                      <ChevronLeft size={14} /> Home Practice
                    </button>
                    {folderBreadcrumbs.slice(0, -1).map((crumb) => (
                      <React.Fragment key={crumb.id}>
                        <span className="pv-crumb-sep" aria-hidden="true">/</span>
                        <button
                          type="button"
                          onClick={() => handleOpenFolder(crumb)}
                          className="pv-crumb pv-tap pv-focus"
                        >
                          {crumb.title}
                        </button>
                      </React.Fragment>
                    ))}
                  </nav>
                  <h2 className="pv-fhead-title">{activeFolder.title}</h2>
                  {activeFolder.description ? <p className="pv-fhead-desc">{activeFolder.description}</p> : null}
                  <div className="pv-fchips">
                    {activeFolder.videos.length ? (
                      <span className="pv-fchip"><PlayCircle size={14} /> {activeFolder.videos.length} {activeFolder.videos.length === 1 ? 'Video' : 'Videos'}</span>
                    ) : null}
                    {activeFolder.photos?.length ? (
                      <span className="pv-fchip"><ImageIcon size={14} /> {activeFolder.photos.length} {activeFolder.photos.length === 1 ? 'Photo Guide' : 'Photo Guides'}</span>
                    ) : null}
                    {activeFolder.videos.length ? (
                      <span className={`pv-fchip ${activeFolderCompleted >= activeFolder.videos.length ? 'pv-fchip--jade' : ''}`}>
                        <CheckCircle2 size={14} /> {activeFolderCompleted}/{activeFolder.videos.length} Complete
                      </span>
                    ) : null}
                  </div>
                </div>

                <FolderGrid title="Subfolders" folders={childFolders} progressByVideoId={progressByVideoId} onOpen={handleOpenFolder} />
                <VideoRow title="Videos" icon={<PlayCircle size={17} />} videos={activeFolder.videos} progressByVideoId={progressByVideoId} onPlay={openVideo} newVideoIdSet={newVideoIdSet} />
                <PhotoRow title="Photo Guides" photos={activeFolder.photos || []} />
              </section>
            ) : (
            <>
                <FolderGrid folders={rootFolders} progressByVideoId={progressByVideoId} onOpen={handleOpenFolder} title="Training Series" />

                {/* Student-Crafted Library Banner */}
                {!libraryQuery && !bannerDismissed && (
                  <aside className="pv-student-banner pv-rise" style={{ animationDelay: '0.3s' }}>
                    <button type="button" className="pv-sb-dismiss" onClick={dismissBanner} aria-label="Dismiss">&times;</button>
                    <div className="pv-sb-inner">
                      <div className="pv-sb-emoji">🥋</div>
                      <div className="pv-sb-body">
                        <h3 className="pv-sb-title">Built by Students, <span>For Students</span></h3>
                        <p className="pv-sb-text">
                          Every video here is <strong>recorded and edited by our own students</strong> as part of their training journey. Seniors create these to help juniors practise at home — the techniques you see have already been taught in class. You might spot some rough edges in camera work or sound, and that&apos;s because this library is 100% student-driven. We think that makes it even more special.
                        </p>
                      </div>
                    </div>
                  </aside>
                )}

                {/* Keep Drilling (deliberate repetition, least-drilled first) */}
                {keepDrilling.length > 0 && !libraryQuery && (
                  <VideoRow title="Keep Drilling" icon={<Repeat size={17} />} videos={keepDrilling} progressByVideoId={progressByVideoId} onPlay={openVideo} compact={true} />
                )}

                {/* Recently added content */}
                {!libraryQuery && newReleases.length >= 3 && (
                  <VideoRow title="New Releases" icon={<Sparkles size={17} />} videos={newReleases} progressByVideoId={progressByVideoId} onPlay={openVideo} compact={true} newVideoIdSet={newVideoIdSet} />
                )}

                {/* Search Results */}
                {libraryQuery && searchedLibrary.unfiledVideos.length > 0 && (
                  <Shelf>
                    <SectionHead icon={<Search size={17} />} title="Search Results" />
                    <div className="pv-grid pv-grid-videos">
                      {searchedLibrary.unfiledVideos.map((video) => (
                        <VideoTile
                          key={video.id}
                          video={video}
                          progressByVideoId={progressByVideoId}
                          onPlay={openVideo}
                          variant="grid"
                          isNew={newVideoIdSet.has(video.id)}
                        />
                      ))}
                    </div>
                  </Shelf>
                )}
                
                <PhotoRow title="Photo Reference" photos={searchedLibrary.unfiledPhotos} />
                {libraryQuery && !searchedLibrary.folders.length && !searchedLibrary.unfiledVideos.length && !searchedLibrary.unfiledPhotos.length ? (
                  <div className="pv-nomatch">
                    <Search size={36} style={{ marginBottom: '1.2rem', opacity: 0.3 }} />
                    <p style={{ margin: 0 }}>No practice content matches “{libraryQuery}”.</p>
                    <button type="button" className="pv-tap pv-focus" onClick={() => setLibraryQuery('')}>Clear Search</button>
                  </div>
                ) : null}
              </>
            )}
          </main>
        )}

        {typeof document !== 'undefined' ? createPortal(
          <AnimatePresence>
            {playingVideo && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`pv-player ${isVideoPlaying ? 'pv-player--cinematic' : ''}`}
              >
                {/* Floating Back Button */}
                <button type="button" onClick={closePlayerToLibrary} className="pv-floating-back pv-tap pv-focus">
                  <ChevronLeft size={20} /> Back
                </button>

                <div ref={viewerScrollRef} className="pv-viewer">
                  <div className={`pv-pcol ${playingVideo.contentFormat === 'short' ? 'pv-pcol--short' : 'pv-pcol--wide'}`}>
                    <div className={`pv-pbox ${playingVideo.contentFormat === 'short' ? 'pv-pbox--short' : ''}`}>
                      <YouTubeNativePlayer
                        youtubeId={playingVideo.youtubeId}
                        title={playingVideo.title}
                        posterUrl={playingVideo.thumbnail}
                        initialProgressPercent={Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0)}
                        initialSeconds={Number(progressByVideoId.get(playingVideo.id)?.watchedSeconds || 0)}
                        contentFormat={playingVideo.contentFormat}
                        onProgress={({ progressPercent, seconds }) => saveProgress(playingVideo.id, progressPercent, seconds)}
                        onEscape={closePlayerToLibrary}
                        onPlayStateChange={setIsVideoPlaying}
                      />
                    </div>
                    
                    <div className="pv-vhead">
                      <h1 className="pv-vhead-title">{playingVideo.title}</h1>
                      <div className="pv-vhead-meta">
                        {playingVideo.category ? <span className="pv-fchip">{formatCategoryLabel(playingVideo.category)}</span> : null}
                        {playingVideo.duration ? <span className="pv-fchip"><Clock size={13} /> {playingVideo.duration}</span> : null}
                      </div>
                    </div>

                    {playingVideo.lessonNote ? (
                      <aside className="pv-note">
                        <div className="pv-note-tag">
                          Instructor Note
                        </div>
                        <p>{playingVideo.lessonNote}</p>
                      </aside>
                    ) : null}

                    <div className="pv-vactions">
                      <button
                        type="button"
                        onClick={() => recordPracticed(playingVideo)}
                        className="pv-btn-practiced pv-tap pv-focus"
                        aria-label={`Practiced: ${Number(progressByVideoId.get(playingVideo.id)?.practicedCount || 0)} times`}
                      >
                        <Repeat size={22} /> Practiced <b>{Number(progressByVideoId.get(playingVideo.id)?.practicedCount || 0)}×</b>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleCompletion(playingVideo)}
                        className={`pv-huge-complete pv-tap pv-focus ${Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0) >= 100 ? 'pv-huge-complete--on' : ''}`}
                      >
                        {Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0) >= 100 ? (
                          <><CheckCircle2 size={24} color="currentColor" /> Completed</>
                        ) : (
                          <><CheckCircle2 size={24} color="currentColor" /> Mark as Complete</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        ) : null}
      </div>
      )}
      </MotionConfig>
    </SecureContentWrapper>
  )
}

/**
 * Scroll-reveal wrapper that gives every shelf the same cinematic entrance
 * without re-triggering while the athlete filters via search.
 */
function Shelf({ children, ...restProps }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-48px' }}
      transition={{ duration: 0.55, ease: SHELF_EASE }}
      {...restProps}
    >
      {children}
    </motion.section>
  )
}

function SectionHead({ icon, title }) {
  return (
    <div className="pv-shelfhead">
      <h2 className="pv-shelftitle">
        <span className="pv-shelfic">{icon}</span>
        {title}
      </h2>
    </div>
  )
}

function FolderGrid({ folders, progressByVideoId, onOpen, title = 'Training Series' }) {
  if (!folders.length) return null

  return (
    <Shelf>
      <SectionHead icon={<FolderOpen size={17} />} title={title} />
      <div className="pv-grid pv-grid-folders">
        {folders.map((folder) => {
          const videoCount = folder.videos?.length || 0
          const completedCount = folder.videos.filter((video) => Number(progressByVideoId.get(video.id)?.progressPercent || 0) >= 100).length
          const percent = folder.videos.length ? Math.round((completedCount / folder.videos.length) * 100) : 0

          return (
            <motion.button
              key={folder.id}
              type="button"
              onClick={() => onOpen(folder)}
              aria-label={`Open folder ${folder.title}`}
              className="pv-fcard pv-tap pv-focus"
              whileTap={{ scale: 0.985 }}
            >
              <div className="pv-fcard-top">
                <span className="pv-fcard-ic"><Folder size={23} strokeWidth={2} /></span>
              </div>
              <div className="pv-fcard-content">
                <div className="pv-fcard-name">{folder.title}</div>
                <div className="pv-fcard-meta">
                  {videoCount > 0 ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : ''}
                </div>
                {folder.videos.length ? (
                  <div className="pv-fprog">
                    <div className="pv-fprog-track">
                      <div
                        className={`pv-fprog-fill ${percent >= 100 ? 'pv-fprog-fill--full' : ''}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="pv-fprog-lbl">
                      <span><b>{completedCount}/{folder.videos.length}</b> complete</span>
                      <span>{percent}%</span>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="pv-fcard-top" style={{ marginLeft: 'auto' }}>
                <span className="pv-fcard-go"><ArrowRight size={16} /></span>
              </div>
            </motion.button>
          )
        })}
      </div>
    </Shelf>
  )
}

function PhotoRow({ title = 'Photo Reference', photos }) {
  const railRef = useRef(null)

  if (!photos.length) return null

  function pageRail(direction) {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <Shelf>
      <SectionHead icon={<ImageIcon size={17} />} title={title} />
      <div className="pv-railwrap">
        <div ref={railRef} className="pv-rail kuroobi-scrollbar-hide">
          {photos.map((photo) => (
            <a key={photo.id} href={photo.imageUrl} target="_blank" rel="noreferrer" className="pv-ph pv-tap" style={{ flex: '0 0 auto', width: '240px' }}>
              <div className="pv-ph-frame">
                <img className="pv-ph-img" src={photo.imageUrl} alt={photo.title} loading="lazy" decoding="async" />
                <span className="pv-ph-zoom"><Maximize2 size={14} /></span>
              </div>
              <div className="pv-ph-cap">{photo.title}</div>
              {photo.description ? <div className="pv-ph-desc">{photo.description}</div> : null}
            </a>
          ))}
        </div>
        <button type="button" aria-label={`Scroll ${title} backwards`} className="pv-arrow pv-arrow--l pv-tap pv-focus" onClick={() => pageRail(-1)}>
          <ChevronLeft size={22} />
        </button>
        <button type="button" aria-label={`Scroll ${title} forwards`} className="pv-arrow pv-arrow--r pv-tap pv-focus" onClick={() => pageRail(1)}>
          <ChevronRight size={22} />
        </button>
      </div>
    </Shelf>
  )
}

function VideoRow({ title, icon, videos, progressByVideoId, onPlay, compact = false, newVideoIdSet }) {
  const railRef = useRef(null)

  if (!videos.length) return null

  // Netflix-style paging: arrows glide the rail by roughly one viewport width.
  function pageRail(direction) {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <Shelf>
      <SectionHead icon={icon} title={title} />
      {compact ? (
        <div className="pv-railwrap">
          <div ref={railRef} className="pv-rail kuroobi-scrollbar-hide">
            {videos.map((video) => (
              <VideoTile
                key={`${title}-${video.id}`}
                video={video}
                progressByVideoId={progressByVideoId}
                onPlay={onPlay}
                variant="rail"
                sizes="(max-width: 640px) 66vw, 320px"
                isNew={Boolean(newVideoIdSet && newVideoIdSet.has(video.id))}
              />
            ))}
          </div>
          <button type="button" aria-label={`Scroll ${title} backwards`} className="pv-arrow pv-arrow--l pv-tap pv-focus" onClick={() => pageRail(-1)}>
            <ChevronLeft size={22} />
          </button>
          <button type="button" aria-label={`Scroll ${title} forwards`} className="pv-arrow pv-arrow--r pv-tap pv-focus" onClick={() => pageRail(1)}>
            <ChevronRight size={22} />
          </button>
        </div>
      ) : (
        <div className="pv-grid pv-grid-videos">
          {videos.map((video) => (
            <VideoTile
              key={`${title}-${video.id}`}
              video={video}
              progressByVideoId={progressByVideoId}
              onPlay={onPlay}
              variant="grid"
              sizes="(max-width: 640px) 100vw, 400px"
              isNew={Boolean(newVideoIdSet && newVideoIdSet.has(video.id))}
            />
          ))}
        </div>
      )}
    </Shelf>
  )
}

/**
 * One uniform 16/9 tile — the same footprint in rails and grids so every
 * shelf reads as a straight line, exactly like a streaming service.
 * Shorts are centre-cropped for their thumbnail but always open in their
 * native 9/16 player.
 */
function VideoTile({ video, progressByVideoId, onPlay, variant, sizes, isNew = false }) {
  const compact = variant === 'rail'
  const progress = Number(progressByVideoId.get(video.id)?.progressPercent || 0)
  const practicedCount = Number(progressByVideoId.get(video.id)?.practicedCount || 0)
  const isDone = progress >= 100

  return (
    <motion.button
      type="button"
      onClick={() => !video.locked && onPlay(video)}
      className={`pv-tap pv-focus pv-tile${isDone ? ' pv-tile--done' : ''}${video.locked ? ' pv-tile--locked' : ''}`}
      whileHover={!video.locked ? { y: -4, scale: 1.01 } : undefined}
      whileTap={!video.locked ? { scale: 0.97 } : undefined}
      style={{
        flex: compact ? '0 0 clamp(200px, 82vw, 330px)' : undefined,
        minWidth: 0,
        scrollSnapAlign: compact ? 'start' : undefined,
      }}
      aria-label={video.locked ? `${video.title} (locked)` : `Play ${video.title}`}
    >
      <YouTubeThumbnail youtubeId={video.youtubeId} alt={video.title} fill sizes={sizes} style={{ objectFit: 'cover', filter: video.locked ? 'grayscale(100%) brightness(0.35)' : 'none' }} />
      <span className="pv-tile-scrim" />

      {video.duration ? (
        <span className="pv-chipdur">
          <Clock size={11} /> {video.duration}
        </span>
      ) : null}

      <div className="pv-tile-tl">
        {isNew ? (
          <span className="pv-chipnew">New</span>
        ) : null}

        {isDone ? (
          <span title="Completed" aria-label="Completed" className="pv-badgedone">
            <CheckCircle2 size={16} />
          </span>
        ) : null}

        {practicedCount > 0 ? (
          <span title={`Practiced ${practicedCount}×`} aria-label={`Practiced ${practicedCount} times`} className="pv-chippractice">
            <Repeat size={11} /> {practicedCount}×
          </span>
        ) : null}
      </div>

      {!video.locked ? (
        <span className="pv-playbtn">
          <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />
        </span>
      ) : (
        <span className="pv-lockov">
          <Lock size={26} />
        </span>
      )}

      <span className="pv-tileinfo">
        <span className="pv-tiletitle">{video.title}</span>
        {video.category ? (
          <span className="pv-tilemeta">{formatCategoryLabel(video.category)}</span>
        ) : null}
      </span>

      {progress > 0 && progress < 100 ? (
        <span className="pv-tilebar">
          <i style={{ width: `${progress}%` }} />
        </span>
      ) : null}
    </motion.button>
  )
}
