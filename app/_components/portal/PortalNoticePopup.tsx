'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Info, X } from 'lucide-react'

const NOTICE_TEXT =
  'Please note: this video is meant only for practice and revision at home — the techniques have already been taught in class, so it\u2019s not intended to teach anything new. You may also notice a few quality issues (camera angle, sound, or editing), since it\u2019s recorded and edited entirely by our students as part of their training. We hope you\u2019ll understand and enjoy watching them in action!'

function subscribe() {
  return () => {}
}

export default function PortalNoticePopup() {
  const [open, setOpen] = useState(false)
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)

  useEffect(() => {
    if (!mounted) return
    const hasSeen = localStorage.getItem('skf_practice_notice_seen')
    if (hasSeen === 'true') return

    const timer = window.setTimeout(() => setOpen(true), 350)
    return () => window.clearTimeout(timer)
  }, [mounted])

  const dismiss = () => {
    localStorage.setItem('skf_practice_notice_seen', 'true')
    setOpen(false)
  }

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="pnp-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="pnp-toast"
            role="dialog"
            aria-modal="false"
            aria-label="Practice video notice"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          >
            <div className="pnp-toast-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div className="pnp-toast-icon"><Info size={16} /></div>
                <h2 className="pnp-toast-title">Practice Library Note</h2>
              </div>
              <button className="pnp-toast-close" onClick={dismiss} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            
            <p className="pnp-toast-text">{NOTICE_TEXT}</p>

            <div className="pnp-actions">
              <button className="pnp-btn pnp-btn--primary" onClick={dismiss}>
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}