'use client'

import { useEffect, useRef, useState } from 'react'

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

export default function YouTubeNativePlayer({
  youtubeId,
  title,
  initialProgressPercent = 0,
  initialSeconds = 0,
  onProgress,
  onComplete,
  onEscape,
  onPlayStateChange,
  contentFormat = 'landscape',
}: YouTubeNativePlayerProps) {
  const frameSlotRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const pollRef = useRef<number | null>(null)
  const lastReportedProgressRef = useRef(0)
  const completedReportedRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  const onCompleteRef = useRef(onComplete)
  const initialProgressRef = useRef(initialProgressPercent)
  const initialSecondsRef = useRef(initialSeconds)

  const [error, setError] = useState('')

  useEffect(() => {
    initialProgressRef.current = initialProgressPercent
    initialSecondsRef.current = initialSeconds
    onProgressRef.current = onProgress
    onCompleteRef.current = onComplete
  }, [initialProgressPercent, initialSeconds, onComplete, onProgress])

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
            autoplay: 1,
            controls: 1,
            disablekb: 0,
            fs: 1,
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
              iframe.style.width = '100%'
              iframe.style.height = '100%'
              iframe.style.pointerEvents = 'auto'

              const readyDuration = player.getDuration() || 0
              const resumeAt = Number(initialSecondsRef.current || 0)
              const rawPercent = Number(initialProgressRef.current || 0)
              const percentResume = Math.max(0, Math.min(95, rawPercent))

              // Resume from saved position (but not if already completed)
              if (rawPercent < 100 && resumeAt > 3 && resumeAt < (readyDuration - 3)) {
                player.seekTo(resumeAt, true)
              } else if (readyDuration > 0 && rawPercent > 0 && rawPercent < 100) {
                const startAt = (readyDuration * percentResume) / 100
                player.seekTo(startAt, true)
              }

              // Silent background progress polling
              pollRef.current = window.setInterval(() => {
                const currentPlayer = playerRef.current
                if (!currentPlayer) return
                const currentTime = currentPlayer.getCurrentTime() || 0
                const duration = currentPlayer.getDuration() || 0
                const progress = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0

                if (
                  progress > 0 &&
                  progress < 100 &&
                  Math.abs(progress - lastReportedProgressRef.current) >= 5
                ) {
                  lastReportedProgressRef.current = progress
                  onProgressRef.current?.({ progressPercent: progress, seconds: Math.floor(currentTime) })
                }
              }, 500)
            },
            onStateChange: (event) => {
              const state = window.YT?.PlayerState
              if (!state) return

              const isPlaying = event.data === state.PLAYING
              onPlayStateChange?.(isPlaying)

              // Lock to landscape when entering native fullscreen while playing
              if (isPlaying && contentFormat === 'landscape') {
                try {
                  const iframe = playerRef.current?.getIframe()
                  if (iframe && document.fullscreenElement === iframe) {
                    if (screen.orientation && screen.orientation.lock) {
                      screen.orientation.lock('landscape').catch(() => {})
                    }
                  }
                } catch {}
              }

              if (event.data === state.ENDED) {
                if (!completedReportedRef.current) {
                  completedReportedRef.current = true
                  const finalDuration = playerRef.current?.getDuration() || 0
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

      try {
        playerRef.current?.stopVideo()
        playerRef.current?.destroy()
      } catch {
        // The YouTube API can throw if the iframe is already gone during fast route changes.
      } finally {
        playerRef.current = null
      }
    }
  }, [title, youtubeId, contentFormat, onPlayStateChange])

  // Escape key to close the player overlay
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onEscape])

  // Unlock orientation when fullscreen exits
  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        try {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock()
          }
        } catch {}
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      try {
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock()
        }
      } catch {}
    }
  }, [])

  return (
    <div
      role="application"
      aria-label={`${title || 'Video'} player`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: '#000',
      }}
    >
      <div
        ref={frameSlotRef}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        }}
      />

      {error ? (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)',
        }}>
          <div style={{ color: '#ff9a9a', fontWeight: 700 }}>{error}</div>
        </div>
      ) : null}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
