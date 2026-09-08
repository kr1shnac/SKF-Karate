'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Award, DatabaseBackup, Fingerprint, LoaderCircle, Search, ShieldCheck, Settings, X } from 'lucide-react'
import { isCertificateNumber, isVerificationCode } from '@/lib/certificates/registration'
import './verify.css'

export default function CertificateSearchPage() {
    const router = useRouter()
    const [query, setQuery] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [maintenance, setMaintenance] = useState(false)

    async function handleSearch(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const lookup = query.trim()
        if (!lookup) return

        setIsLoading(true)
        setMaintenance(false)

        // Simulate scanning network request for dramatic effect
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        // Show maintenance state
        setMaintenance(true)
        setIsLoading(false)
    }

    return (
        <div className="verify-page">
            <div className="verify-bg" />
            
            <div className="verify-container">
                {/* ═══════ HEADER ═══════ */}
                <div className="verify-header">
                    <div className="verify-icon-wrapper">
                        <Award className="verify-icon" aria-hidden="true" />
                    </div>
                    <h1 className="verify-title">
                        Certificate <span className="text-gradient">Verification</span>
                    </h1>
                    <p className="verify-subtitle">
                        Enter a certificate number or QR verification code. Verified records open the same
                        official SKF certificate status page used by QR scans.
                    </p>
                </div>

                {/* ═══════ SEARCH FORM ═══════ */}
                <form
                    onSubmit={handleSearch}
                    className={`verify-form-wrapper ${isLoading ? 'is-scanning' : ''}`}
                >
                    <div className="scanner-line" />
                    
                    <div className="verify-input-group">
                        <div className="verify-input-wrapper" style={{ display: 'flex', flex: 1 }}>
                            <Search className="verify-search-icon" size={24} />
                            <input 
                                type="text" 
                                placeholder="ex. SKF-C-000001"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                className="verify-input"
                                disabled={isLoading}
                                spellCheck={false}
                                autoComplete="off"
                            />
                        </div>
                        <button 
                            type="submit" 
                            className="verify-btn"
                            disabled={isLoading || !query.trim()}
                        >
                            <span className="btn-content">
                                {isLoading ? (
                                    <>
                                        <LoaderCircle className="spin" size={18} /> Scanning...
                                    </>
                                ) : (
                                    'Authenticate'
                                )}
                            </span>
                        </button>
                    </div>
                </form>

                {/* ═══════ MAINTENANCE POPUP ═══════ */}
                {maintenance && (
                    <div style={{
                        position: 'fixed',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(5, 8, 15, 0.85)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1rem',
                        animation: 'verifyOverlayFade 0.3s ease forwards'
                    }}>
                        <div style={{
                            position: 'relative',
                            padding: '3rem 2.5rem',
                            borderRadius: '24px',
                            background: 'linear-gradient(145deg, rgba(20, 20, 25, 0.95), rgba(10, 10, 12, 0.95))',
                            border: '1px solid rgba(255, 183, 3, 0.15)',
                            boxShadow: '0 30px 60px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,183,3,0.1)',
                            overflow: 'hidden',
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '1.2rem',
                            maxWidth: '460px',
                            width: '100%',
                            animation: 'verifyPopupIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards'
                        }}>
                            {/* Close Button */}
                            <button 
                                onClick={() => setMaintenance(false)}
                                style={{
                                    position: 'absolute',
                                    top: '1.25rem',
                                    right: '1.25rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'rgba(255,255,255,0.5)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    zIndex: 10
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                                    e.currentTarget.style.color = '#fff';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                    e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                                }}
                                aria-label="Close"
                            >
                                <X size={18} />
                            </button>

                            {/* Ambient Glow */}
                            <div style={{
                                position: 'absolute',
                                top: '-50%', left: '50%',
                                transform: 'translateX(-50%)',
                                width: '200px', height: '100px',
                                background: 'rgba(255, 183, 3, 0.2)',
                                filter: 'blur(60px)',
                                pointerEvents: 'none'
                            }} />
                            
                            {/* Icon Badge */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '72px',
                                height: '72px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, rgba(255, 183, 3, 0.1), rgba(255, 183, 3, 0.02))',
                                border: '1px solid rgba(255, 183, 3, 0.3)',
                                boxShadow: '0 0 30px rgba(255, 183, 3, 0.15), inset 0 0 15px rgba(255, 183, 3, 0.1)',
                                color: '#ffb703',
                                marginBottom: '0.5rem'
                            }}>
                                <Settings className="verify-spin-slow" size={32} />
                            </div>

                            {/* Text Content */}
                            <div>
                                <h3 style={{ 
                                    color: '#fff', 
                                    fontSize: '1.75rem', 
                                    fontWeight: 700, 
                                    marginBottom: '0.75rem',
                                    letterSpacing: '-0.02em',
                                    fontFamily: 'var(--font-heading)'
                                }}>
                                    System Upgrade
                                </h3>
                                <p style={{ 
                                    color: 'rgba(255,255,255,0.6)', 
                                    fontSize: '1rem',
                                    lineHeight: '1.6',
                                    maxWidth: '420px',
                                    margin: '0 auto'
                                }}>
                                    Our global certificate registry is currently undergoing a scheduled infrastructure upgrade to bring you an even better verification experience.
                                </p>
                            </div>
                            
                            {/* Status Pill */}
                            <div style={{
                                marginTop: '1rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                padding: '0.5rem 1.25rem',
                                borderRadius: '100px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                fontSize: '0.75rem',
                                color: 'rgba(255,255,255,0.5)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.15em',
                                fontWeight: 600
                            }}>
                                <span style={{ 
                                    width: '8px', 
                                    height: '8px', 
                                    borderRadius: '50%', 
                                    background: '#ffb703', 
                                    boxShadow: '0 0 10px #ffb703', 
                                    display: 'inline-block', 
                                    animation: 'verifyPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' 
                                }} />
                                Maintenance Mode
                            </div>
                        </div>
                        
                        <style>{`
                            @keyframes verifyOverlayFade {
                                from { opacity: 0; backdrop-filter: blur(0px); }
                                to { opacity: 1; backdrop-filter: blur(12px); }
                            }
                            @keyframes verifyPopupIn {
                                from { opacity: 0; transform: translateY(30px) scale(0.95); }
                                to { opacity: 1; transform: translateY(0) scale(1); }
                            }
                            @keyframes verifyPulse {
                                0%, 100% { opacity: 0.5; box-shadow: 0 0 4px #ffb703; }
                                50% { opacity: 1; box-shadow: 0 0 15px #ffb703, 0 0 5px #fff; }
                            }
                            .verify-spin-slow {
                                animation: verifySpin 12s linear infinite;
                            }
                            @keyframes verifySpin {
                                from { transform: rotate(0deg); }
                                to { transform: rotate(360deg); }
                            }
                        `}</style>
                    </div>
                )}

                {/* ═══════ TRUST BADGES ═══════ */}
                <div className="verify-trust-badges">
                    <div className="trust-badge gold">
                        <ShieldCheck size={16} /> Official Records
                    </div>
                    <div className="trust-badge blue">
                        <DatabaseBackup size={16} /> Digitally Signed
                    </div>
                    <div className="trust-badge green">
                        <Fingerprint size={16} /> Identity Linked
                    </div>
                </div>
            </div>
        </div>
    )
}
