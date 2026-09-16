'use client'

import React from 'react'

import { SkeletonBlock, SkeletonLine } from './SkeletonPrimitives'

export const VideosPageSkeleton = () => (
  <div className="pv-root" aria-label="Loading Home Practice" aria-busy="true">
    <header className="pv-cinematic-header">
      <div className="pv-floating-search">
        <SkeletonBlock width="100%" height={56} radius={99} />
      </div>
    </header>

    <div className="pv-hero-banner">
      <div className="pv-hero-glass">
        <div className="pv-hero-bg">
          <SkeletonBlock width="100%" height="100%" radius={0} style={{ position: 'absolute', inset: 0 }} />
        </div>
        <div className="pv-hero-scrim" />
        <div className="pv-hero-content-wrapper">
          <div className="pv-hero-content" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <SkeletonLine width="140px" height={16} style={{ marginBottom: '1.2rem', borderRadius: 4 }} />
            <SkeletonLine width="80%" height={clampSize(40, 60)} style={{ marginBottom: '1rem', borderRadius: 8 }} />
            <SkeletonLine width="60%" height={clampSize(30, 40)} style={{ marginBottom: '1.5rem', borderRadius: 8 }} />
            <SkeletonLine width="50%" height={14} style={{ marginBottom: '2rem', borderRadius: 4 }} />
          </div>
        </div>
      </div>
    </div>

    <div className="pv-shell">
      {/* Folder Grid (Training Series) */}
      <section style={{ marginBottom: '3rem' }}>
        <div className="pv-shelfhead">
          <SkeletonBlock width={30} height={30} radius={8} />
          <SkeletonLine width={180} height={20} style={{ borderRadius: 6 }} />
        </div>
        <div className="pv-grid pv-grid-folders">
          {[0, 1, 2].map((card) => (
            <div className="pv-fcard" key={card}>
              <div className="pv-fcard-ic" style={{ background: 'transparent' }}>
                <SkeletonBlock width={48} height={48} radius={12} />
              </div>
              <div className="pv-fcard-content" style={{ flex: 1 }}>
                <SkeletonLine width="70%" height={18} style={{ borderRadius: 6, marginBottom: '0.4rem' }} />
                <SkeletonLine width="40%" height={12} style={{ borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Videos Rail */}
      <section>
        <div className="pv-shelfhead">
          <SkeletonBlock width={30} height={30} radius={8} />
          <SkeletonLine width={150} height={20} style={{ borderRadius: 6 }} />
        </div>
        <div className="pv-railwrap">
          <div className="pv-rail" style={{ overflowX: 'hidden' }}>
            {[0, 1, 2, 3].map((card) => (
              <div key={card} style={{ flex: '0 0 clamp(230px, 24vw, 330px)' }}>
                <SkeletonBlock width="100%" height="auto" radius={20} style={{ aspectRatio: '16 / 9' }} />
                <div style={{ padding: '0.8rem 0.5rem' }}>
                   <SkeletonLine width="85%" height={16} style={{ borderRadius: 4, marginBottom: '0.4rem' }} />
                   <SkeletonLine width="50%" height={12} style={{ borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  </div>
)

// Helper to estimate clamp sizes for skeleton
function clampSize(min: number, max: number) {
  if (typeof window === 'undefined') return min
  return window.innerWidth < 640 ? min : max
}
