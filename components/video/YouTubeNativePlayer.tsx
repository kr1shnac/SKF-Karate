'use client'

import type { CSSProperties } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'

type YouTubePlayerStateEvent = {
  data: number
}

type YouTubePlayer = {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  destroy: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getVolume: () => number
  setVolume: (volume: number) => void
  setPlaybackQuality: (quality: string) => void
  mute: () => void
  unMute: () => void
  isMuted: () => boolean
  setPlaybackRate: (rate: number) => void
  getIframe: () => HTMLIFrameElement
}

type YouTubeConstructor = new (
  element: HTMLElement,
  options: {
    videoId: string
    host?: string
    playerVars: Record<string, string | number>
    events: {
      onReady: () => void
      onStateChange: (event: YouTubePlayerStateEvent) => void
    }
  }
) => YouTubePlayer

declare global {
  interface Window {
    YT?: {
      Player: YouTubeConstructor
      PlayerState: {
        ENDED: number
        PLAYING: number
        PAUSED: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type FullscreenElementAwareDocument = Document & {
  webkitFullscreenElement?: Element | null
  mozFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void>
  mozCancelFullScreen?: () => Promise<void>
  msExitFullscreen?: () => Promise<void>
  webkitRequestFullscreen?: () => Promise<void>
  mozRequestFullScreen?: () => Promise<void>
  msRequestFullscreen?: () => Promise<void>
}

function getFullscreenElement() {
  if (typeof document === 'undefined') return null
  const doc = document as FullscreenElementAwareDocument
  return document.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement
}
function exitFullscreen() {
  if (typeof document === 'undefined') return Promise.resolve()
  if (document.exitFullscreen) return document.exitFullscreen()
  const doc = document as FullscreenElementAwareDocument
  if (doc.webkitExitFullscreen) return doc.webkitExitFullscreen()
  if (doc.mozCancelFullScreen) return doc.mozCancelFullScreen()
  if (doc.msExitFullscreen) return doc.msExitFullscreen()
  return Promise.resolve()
}
type RequestFullscreenLike = {
  webkitRequestFullscreen?: () => Promise<void>
  mozRequestFullScreen?: () => Promise<void>
  msRequestFullscreen?: () => Promise<void>
}

function requestFullscreen(el: HTMLElement | null) {
  if (!el) return Promise.resolve()
  const fullscreenEl = el as HTMLElement & RequestFullscreenLike
  if (el.requestFullscreen) return el.requestFullscreen()
  if (fullscreenEl.webkitRequestFullscreen) return fullscreenEl.webkitRequestFullscreen()
  if (fullscreenEl.mozRequestFullScreen) return fullscreenEl.mozRequestFullScreen()
  if (fullscreenEl.msRequestFullscreen) return fullscreenEl.msRequestFullscreen()
  return Promise.resolve()
}

type YouTubeNativePlayerProps = {
  youtubeId: string
  title?: string
  posterUrl?: string | null
  initialProgressPercent?: number
  initialSeconds?: number
  onProgress?: (data: { progressPercent: number; seconds?: number }) => void
  onComplete?: () => void
  onEscape?: () => void
  onPlayStateChange?: (isPlaying: boolean) => void
  contentFormat?: 'landscape' | 'short'
}

let iframeApiPromise: Promise<void> | null = null
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5]

function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube player is only available in the browser.'))
  }

  if (window.YT?.Player) return Promise.resolve()

  if (!iframeApiPromise) {
    iframeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.()
        resolve()
      }

      const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
      if (existingScript) return

      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.onerror = () => reject(new Error('Unable to load YouTube player.'))
      document.head.appendChild(script)
    })
  }

  return iframeApiPromise
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(100, value))
}

export default function YouTubeNativePlayer({
  youtubeId,
  title,
  posterUrl,
  initialProgressPercent = 0,
  initialSeconds = 0,
  onProgress,
  onComplete,
  onEscape,
  onPlayStateChange,
  contentFormat = 'landscape',
}: YouTubeNativePlayerProps) {
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const frameSlotRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const pollRef = useRef<number | null>(null)
  const hideControlsTimerRef = useRef<number | null>(null)
  const lastReportedProgressRef = useRef(0)
  const completedReportedRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  const onCompleteRef = useRef(onComplete)
  const initialProgressRef = useRef(initialProgressPercent)
  const initialSecondsRef = useRef(initialSeconds)

  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(80)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isCompact, setIsCompact] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    initialProgressRef.current = initialProgressPercent
    initialSecondsRef.current = initialSeconds
    onProgressRef.current = onProgress
    onCompleteRef.current = onComplete
  }, [initialProgressPercent, initialSeconds, onComplete, onProgress])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px), (max-height: 600px)')
    const sync = () => setIsCompact(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    lastReportedProgressRef.current = Math.max(0, Math.min(100, Math.round(initialProgressRef.current || 0)))
    completedReportedRef.current = false

    async function initializePlayer() {
      try {
        await loadYouTubeIframeApi()
        if (cancelled || !frameSlotRef.current || !window.YT?.Player) return

        playerRef.current = new window.YT.Player(frameSlotRef.current, {
          videoId: youtubeId,
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            origin: window.location.origin,
            enablejsapi: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              const player = playerRef.current
              if (!player) return

              const iframe = player.getIframe()
              iframe.setAttribute('title', title || 'Video')
              iframe.style.pointerEvents = 'none'
              iframe.style.width = '100%'
              iframe.style.height = '100%'
              iframe.style.transform = 'scale(1.15)'

              player.setVolume(80)
              try {
                player.setPlaybackQuality('hd1080')
              } catch {
                // Older/I-Frame API builds may not expose the quality setter.
              }
              setDuration(player.getDuration() || 0)
              setIsReady(true)

              const readyDuration = player.getDuration() || 0
              const resumeAt = Number(initialSecondsRef.current || 0)
              const rawPercent = Number(initialProgressRef.current || 0)
              const percentResume = Math.max(0, Math.min(95, rawPercent))
              // A finished lesson (>= 100%, or a resume point at the very end)
              // starts over from the top — never dumps the kid back at 95%.
              if (rawPercent < 100 && resumeAt > 3 && resumeAt < (readyDuration - 3)) {
                player.seekTo(resumeAt, true)
                setCurrentTime(resumeAt)
              } else if (readyDuration > 0 && rawPercent > 0 && rawPercent < 100) {
                const startAt = (readyDuration * percentResume) / 100
                player.seekTo(startAt, true)
                setCurrentTime(startAt)
              }

              pollRef.current = window.setInterval(() => {
                const currentPlayer = playerRef.current
                if (!currentPlayer) return
                const nextCurrentTime = currentPlayer.getCurrentTime() || 0
                const nextDuration = currentPlayer.getDuration() || 0
                const nextProgress = nextDuration > 0 ? Math.min(100, Math.round((nextCurrentTime / nextDuration) * 100)) : 0

                setCurrentTime(nextCurrentTime)
                setDuration(nextDuration)
                setIsMuted(currentPlayer.isMuted())

                if (
                  nextProgress > 0 &&
                  nextProgress < 100 &&
                  Math.abs(nextProgress - lastReportedProgressRef.current) >= 5
                ) {
                  lastReportedProgressRef.current = nextProgress
                  onProgressRef.current?.({ progressPercent: nextProgress, seconds: Math.floor(nextCurrentTime) })
                }
              }, 500)
            },
            onStateChange: (event) => {
              const state = window.YT?.PlayerState
              if (!state) return
              setIsPlaying(event.data === state.PLAYING)
              if (event.data === state.ENDED) {
                const finalDuration = playerRef.current?.getDuration() || 0
                setCurrentTime(finalDuration)
                if (!completedReportedRef.current) {
                  completedReportedRef.current = true
                  lastReportedProgressRef.current = 100
                  onProgressRef.current?.({
                    progressPercent: 100,
                    seconds: finalDuration > 0 ? Math.floor(finalDuration) : undefined,
                  })
                  onCompleteRef.current?.()
                }
              }
            },
          },
        })
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load video player.')
      }
    }

    initializePlayer()

    return () => {
      cancelled = true
      if (pollRef.current) window.clearInterval(pollRef.current)
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)

      try {
        playerRef.current?.stopVideo()
        playerRef.current?.destroy()
      } catch {
        // The YouTube API can throw if the iframe is already gone during fast route changes.
      } finally {
        playerRef.current = null
      }
    }
  }, [title, youtubeId])

  useEffect(() => {
    onPlayStateChange?.(isPlaying)
  }, [isPlaying, onPlayStateChange])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (isSpeedMenuOpen) {
          setIsSpeedMenuOpen(false)
          return
        }
        onEscape?.()
      }
      if (event.key === ' ' && isReady) {
        event.preventDefault()
        togglePlayback()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- togglePlayback is deliberately re-subscribed alongside the state it reads.
  }, [isReady, isPlaying, isCompact, isSpeedMenuOpen, onEscape])

  useEffect(() => {
    if (!isPlaying || !controlsVisible) return
    if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)
    hideControlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000)
  }, [controlsVisible, isPlaying])

  useEffect(() => {
    function handleFullscreenChange() {
      if (!getFullscreenElement()) {
        try {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock()
          }
        } catch {}
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
      try {
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock()
        }
      } catch {}
    }
  }, [])

  function revealControls() {
    setControlsVisible(true)
    if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)
    if (isPlaying) {
      hideControlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000)
    }
  }

  function togglePlayback() {
    const player = playerRef.current
    if (!player || !isReady) return
    if (isPlaying) {
      if (getFullscreenElement()) {
        exitFullscreen().catch(() => {})
      }
      player.pauseVideo()
    } else {
      if (playerHostRef.current && !getFullscreenElement()) {
        try {
          requestFullscreen(playerHostRef.current).then(() => {
            if (contentFormat === 'landscape' && screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {})
            }
          }).catch(() => {})
        } catch {}
      }
      player.playVideo()
    }
  }

  function seekToPercent(percent: number) {
    const player = playerRef.current
    if (!player || !duration) return

    const nextTime = (duration * percent) / 100
    player.seekTo(nextTime, true)
    setCurrentTime(nextTime)
  }

  function updateVolume(nextVolume: number) {
    const safeVolume = clampVolume(nextVolume)
    setVolume(safeVolume)
    playerRef.current?.setVolume(safeVolume)
    if (safeVolume === 0) {
      playerRef.current?.mute()
      setIsMuted(true)
    } else if (isMuted) {
      playerRef.current?.unMute()
      setIsMuted(false)
    }
  }

  function toggleMute() {
    const player = playerRef.current
    if (!player) return

    if (player.isMuted() || volume === 0) {
      player.unMute()
      if (volume === 0) updateVolume(60)
      setIsMuted(false)
    } else {
      player.mute()
      setIsMuted(true)
    }
  }

  function selectPlaybackRate(rate: number) {
    playerRef.current?.setPlaybackRate(rate)
    setPlaybackRate(rate)
    setIsSpeedMenuOpen(false)
  }

  async function toggleFullscreen() {
    const host = playerHostRef.current
    if (!host) return

    if (getFullscreenElement()) {
      await exitFullscreen()
    } else {
      await requestFullscreen(host)
      if (contentFormat === 'landscape') {
        try {
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape')
          }
        } catch {}
      }
    }
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const controlSize = 44

  return (
    <div
      ref={playerHostRef}
      role="application"
      aria-label={`${title} video player`}
      data-content-format={contentFormat}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
      onClick={togglePlayback}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // The parent owns the video frame. Avoid a minimum height here: it would
        // distort a portrait Short on compact phones or in landscape orientation.
        minHeight: 0,
        background: '#000',
        overflow: 'hidden',
      }}
    >
      {posterUrl && !isReady ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.7)), url(${posterUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ) : null}

      <div
        ref={frameSlotRef}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          pointerEvents: 'none',
        }}
      />

      {error ? (
        <div style={centerOverlayStyle}>
          <div style={{ color: '#ff9a9a', fontWeight: 700 }}>{error}</div>
        </div>
      ) : null}

      {!isReady && !error ? (
        <div style={centerOverlayStyle}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : null}

      {isReady && !isPlaying ? (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 90, background: 'linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 90, background: 'linear-gradient(to top, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)', pointerEvents: 'none' }} />
          <button
            type="button"
            aria-label="Play video"
            onClick={(event) => {
              event.stopPropagation()
              togglePlayback()
            }}
            style={{
              ...roundButtonStyle,
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: isCompact ? 56 : 78,
              height: isCompact ? 56 : 78,
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255,255,255,0.94)',
              color: '#050505',
              fontSize: '2rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            }}
          >
            <Play size={isCompact ? 23 : 30} fill="currentColor" />
          </button>
        </>
      ) : null}

      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: isCompact
            ? '2.25rem 0.75rem max(0.7rem, env(safe-area-inset-bottom))'
            : '4rem clamp(1rem, 3vw, 2rem) clamp(1rem, 2vw, 1.4rem)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.45) 58%, transparent)',
          opacity: controlsVisible ? 1 : 0,
          transform: controlsVisible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 180ms ease, transform 180ms ease',
          pointerEvents: controlsVisible ? 'auto' : 'none',
        }}
      >
        <input
          aria-label="Seek video"
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={(event) => seekToPercent(Number(event.target.value))}
          style={{
            width: '100%',
            accentColor: '#d62828',
            cursor: 'pointer',
            minHeight: 24,
          }}
        />

        <div
          style={{
            display: 'grid',
            width: '100%',
            gridTemplateColumns: isCompact
              ? `${controlSize}px ${controlSize}px minmax(0, 1fr) 58px ${controlSize}px`
              : `${controlSize}px ${controlSize}px 96px minmax(92px, 1fr) 64px ${controlSize}px`,
            alignItems: 'center',
            gap: isCompact ? '0.45rem' : '0.8rem',
            marginTop: isCompact ? '0.45rem' : '0.8rem',
            color: '#fff',
          }}
        >
          <button type="button" aria-label={isPlaying ? 'Pause video' : 'Play video'} onClick={togglePlayback} style={{ ...controlButtonStyle, width: controlSize, height: controlSize }}>
            {isPlaying ? <Pause size={isCompact ? 17 : 20} fill="currentColor" /> : <Play size={isCompact ? 17 : 20} fill="currentColor" />}
          </button>

          <button type="button" aria-label={isMuted ? 'Unmute video' : 'Mute video'} onClick={toggleMute} style={{ ...controlButtonStyle, width: controlSize, height: controlSize }}>
            {isMuted || volume === 0 ? <VolumeX size={isCompact ? 17 : 20} /> : <Volume2 size={isCompact ? 17 : 20} />}
          </button>

          {!isCompact ? <input
            aria-label="Volume"
            type="range"
            min={0}
            max={100}
            value={isMuted ? 0 : volume}
            onChange={(event) => updateVolume(Number(event.target.value))}
            style={{ width: '100%', minHeight: 24, accentColor: '#fff' }}
          /> : null}

          <TimeLabel currentTime={currentTime} duration={duration} isCompact={isCompact} />

          <div style={{ position: 'relative', width: '100%' }}>
            <button
              type="button"
              aria-label={`Playback speed ${playbackRate}x`}
              aria-expanded={isSpeedMenuOpen}
              onClick={() => setIsSpeedMenuOpen((open) => !open)}
              style={{ minHeight: controlSize, width: '100%', borderRadius: isCompact ? 9 : 12, border: '1px solid rgba(255,255,255,0.18)', background: '#171717', color: '#fff', cursor: 'pointer', padding: isCompact ? '0 0.15rem' : '0 0.35rem', fontSize: isCompact ? '0.75rem' : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              {playbackRate}x <ChevronDown size={isCompact ? 13 : 15} />
            </button>
            {isSpeedMenuOpen ? <div role="menu" aria-label="Playback speed choices" style={{ position: 'absolute', zIndex: 20, bottom: `calc(100% + ${isCompact ? 6 : 8}px)`, right: 0, minWidth: isCompact ? 76 : 92, overflow: 'hidden', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: '#161616', boxShadow: '0 14px 35px rgba(0,0,0,0.48)', padding: 4 }}>
              {PLAYBACK_RATES.map((rate) => <button key={rate} type="button" role="menuitem" onClick={() => selectPlaybackRate(rate)} style={{ width: '100%', border: 0, borderRadius: 7, background: rate === playbackRate ? 'rgba(255,255,255,0.16)' : 'transparent', color: '#fff', cursor: 'pointer', padding: isCompact ? '0.42rem 0.5rem' : '0.5rem 0.6rem', textAlign: 'left', fontSize: isCompact ? '0.72rem' : '0.82rem', fontWeight: rate === playbackRate ? 800 : 600 }}>{rate}x</button>)}
            </div> : null}
          </div>

          {!isPlaying ? (
            <button type="button" aria-label="Toggle fullscreen" onClick={toggleFullscreen} style={{ ...controlButtonStyle, width: controlSize, height: controlSize }}>
              <Maximize2 size={20} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const centerOverlayStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.35)',
} satisfies CSSProperties

const roundButtonStyle = {
  border: 'none',
  borderRadius: '50%',
  minWidth: 44,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: '0 18px 42px rgba(0,0,0,0.35)',
} satisfies CSSProperties

const controlButtonStyle = {
  ...roundButtonStyle,
  minWidth: 0,
  minHeight: 0,
  width: 44,
  height: 44,
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.14)',
  fontSize: '1rem',
} satisfies CSSProperties

/**
 * Isolated time readout. The player polls the YouTube API a couple of times a
 * second while playing; scoping those ticks to this leaf keeps full re-renders
 * of the control bar (and its subscriptions) from happening on every poll.
 */
const TimeLabel = memo(function TimeLabel({ currentTime, duration, isCompact }: { currentTime: number; duration: number; isCompact: boolean }) {
  return (
    <span style={{ minWidth: isCompact ? 70 : 92, fontSize: isCompact ? '0.72rem' : '0.88rem', color: 'rgba(255,255,255,0.78)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  )
})
