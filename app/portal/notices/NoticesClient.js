'use client'

import { motion } from 'framer-motion'
import { Bell, CalendarRange, Clock, Megaphone } from 'lucide-react'

export default function NoticesClient() {
  return (
    <div style={{ padding: '2rem 1rem calc(6rem + env(safe-area-inset-bottom))', maxWidth: '1420px', margin: '0 auto', width: '100%' }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading, "Outfit")', fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Bell size={48} color="var(--gold, #ffb703)" />
          Notice Board
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '1.05rem', fontWeight: 500, maxWidth: '650px', lineHeight: 1.7 }}>
          Official branch notices and event announcements will appear here after the live notices feed is connected.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        style={{
          background: 'rgba(10,14,22,0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '28px',
          padding: '2.5rem',
          display: 'grid',
          gap: '1.5rem',
        }}
      >
        <div style={{ width: 58, height: 58, borderRadius: 20, background: 'rgba(214,40,40,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Megaphone size={30} color="var(--crimson, #d62828)" />
        </div>
        <div>
          <h2 style={{ margin: 0, color: '#fff', fontSize: '1.7rem', fontWeight: 800 }}>No Live Notices Yet</h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, margin: '0.8rem 0 0' }}>
            We removed sample announcements from this production page. Please use your branch WhatsApp group for notices until this feed is enabled.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', color: 'rgba(255,255,255,0.62)', fontSize: '0.9rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 0.85rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999 }}>
            <Clock size={16} /> Coming soon
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 0.85rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999 }}>
            <CalendarRange size={16} /> Events will use live records
          </span>
        </div>
      </motion.div>
    </div>
  )
}
