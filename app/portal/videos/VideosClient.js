'use client'
/* eslint-disable @next/next/no-img-element -- protected Supabase images use short-lived signed URLs. */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderOpen,
  History,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize2,
  Play,
  PlayCircle,
  Search,
  Sparkles,
  TrendingUp,
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
const PRACTICE_LIBRARY_CSS = `
.pv-root{
  --pv-gold:#ffb703;
  --pv-crimson:#d62828;
  --pv-jade:#2dd4bf;
  --pv-surface:rgba(255,255,255,.04);
  --pv-surface-2:rgba(255,255,255,.07);
  --pv-edge:rgba(255,255,255,.08);
  --pv-edge-2:rgba(255,255,255,.16);
  --pv-dim:rgba(255,255,255,.55);
  --pv-dimmer:rgba(255,255,255,.35);
  --pv-heading:var(--font-heading,'Outfit');
  --pv-pad-x:max(4%,1rem);
  position:relative; min-height:100vh; min-height:100dvh; width:100%;
  overflow-x:hidden; background:#000; color:#fff;
  padding-bottom:calc(6rem + env(safe-area-inset-bottom));
}

/* ── Ambient page signature (amber variant of the portal aura) ── */
.pv-aura{position:absolute;top:-12%;left:50%;transform:translateX(-50%);width:86%;max-width:1150px;height:560px;
  background:radial-gradient(ellipse at top,rgba(255,183,3,.13) 0%,transparent 68%);pointer-events:none;z-index:0}
.pv-aura-side{position:absolute;top:26%;left:-9%;width:420px;height:420px;border-radius:50%;
  background:radial-gradient(circle,rgba(214,40,40,.055) 0%,transparent 70%);pointer-events:none;z-index:0}
.pv-aura-deep{position:absolute;bottom:6%;right:-10%;width:480px;height:480px;border-radius:50%;
  background:radial-gradient(circle,rgba(45,212,191,.035) 0%,transparent 70%);pointer-events:none;z-index:0}

/* ── Hero ── */
.pv-hero{position:relative;max-width:1440px;margin:0 auto;
  padding:max(env(safe-area-inset-top),clamp(2.5rem,7vw,4.25rem)) var(--pv-pad-x) clamp(2.25rem,4.5vw,3.25rem)}
.pv-hero-kanji{position:absolute;top:44%;right:max(1%,0);transform:translateY(-50%);
  font-size:clamp(11rem,26vw,19rem);line-height:1;font-weight:900;color:#fff;opacity:.03;
  user-select:none;pointer-events:none;font-family:var(--pv-heading)}
/* Section-style heading — matches .pv-fhead-title so the hero and folder
   views read as one consistent system */
.pv-hero-title{margin:0;font-family:var(--pv-heading);font-size:clamp(1.9rem,5.4vw,2.9rem);font-weight:900;
  letter-spacing:-.025em;line-height:1.08;
  background:linear-gradient(180deg,#fff 30%,rgba(255,255,255,.6) 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.pv-hero-title b{background:linear-gradient(180deg,#ffd34d 10%,#ffb703 90%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.pv-hero-copy{margin:.7rem 0 0;max-width:560px;color:var(--pv-dim);line-height:1.55;font-size:.88rem}

/* Even grid — stat cards always line up in clean rows (2×2 on compact, 4-across on desktop) */
.pv-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin-top:1.9rem}
@media (min-width:900px){.pv-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
.pv-stat{display:flex;align-items:center;gap:.8rem;padding:.85rem 1.15rem;border-radius:18px;min-width:0;
  border:1px solid var(--pv-edge);background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.008));
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.pv-stat-ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex-shrink:0;border:1px solid}
.pv-stat-ic--gold{background:rgba(255,183,3,.1);border-color:rgba(255,183,3,.24);color:var(--pv-gold)}
.pv-stat-ic--red{background:rgba(214,40,40,.1);border-color:rgba(214,40,40,.26);color:#ff7b7b}
.pv-stat-ic--jade{background:rgba(45,212,191,.1);border-color:rgba(45,212,191,.26);color:var(--pv-jade)}
.pv-stat-ic--neutral{background:rgba(255,255,255,.06);border-color:var(--pv-edge-2);color:#fff}
.pv-stat-val{display:block;min-width:0;font-family:var(--pv-heading);font-size:1.32rem;font-weight:850;line-height:1;color:#fff}
.pv-stat-lbl{display:block;margin-top:.3rem;font-size:.62rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--pv-dimmer)}

.pv-searchwrap{position:relative;max-width:540px;margin-top:1.7rem}
.pv-searchicon{position:absolute;left:1.05rem;top:50%;transform:translateY(-50%);color:var(--pv-dimmer);pointer-events:none}
.pv-search{width:100%;min-height:54px;box-sizing:border-box;border-radius:18px;border:1px solid var(--pv-edge);
  background:rgba(255,255,255,.045);color:#fff;padding:.8rem 3.4rem .8rem 3rem;font-size:.95rem;outline:none;
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);transition:border-color .25s ease,background .25s ease,box-shadow .25s ease}
.pv-search::placeholder{color:rgba(255,255,255,.32)}
.pv-search:focus{border-color:rgba(255,183,3,.5);background:rgba(255,183,3,.05);box-shadow:0 0 0 4px rgba(255,183,3,.09)}
@media (max-width:640px){.pv-search{font-size:16px}}
.pv-clear{position:absolute;right:.85rem;top:50%;transform:translateY(-50%);padding:.45rem .75rem;border:0;
  border-radius:10px;background:rgba(255,255,255,.07);color:var(--pv-dim);cursor:pointer;font-weight:800;
  font-size:.76rem;transition:background .2s,color .2s}
.pv-clear:hover{color:#fff;background:rgba(255,255,255,.14)}

/* ── Shelves ── */
.pv-shell{position:relative;z-index:1;display:grid;gap:2.75rem;max-width:1440px;margin:0 auto;padding-bottom:1.5rem}
.pv-shelfhead{display:flex;align-items:center;gap:.9rem;
  padding:0 var(--pv-pad-x);margin-bottom:1.15rem}
.pv-shelfhead::after{content:'';flex:1;height:1px;
  background:linear-gradient(90deg,rgba(255,255,255,.13),transparent 82%)}
.pv-shelftitle{display:flex;align-items:center;gap:.55rem;margin:0;font-family:var(--pv-heading);
  font-size:clamp(1.05rem,.96rem+.5vw,1.2rem);font-weight:800;letter-spacing:-.01em}
.pv-shelfic{width:29px;height:29px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;
  background:rgba(255,183,3,.08);color:var(--pv-gold)}

.pv-grid{display:grid;gap:1.15rem;padding:0 var(--pv-pad-x);align-items:start}
.pv-grid-folders{grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
.pv-grid-videos{grid-template-columns:repeat(auto-fill,minmax(255px,1fr))}
.pv-grid-photos{grid-template-columns:repeat(auto-fill,minmax(205px,1fr))}

/* Netflix-style rail */
.pv-railwrap{position:relative}
.pv-rail{display:flex;gap:1rem;overflow-x:auto;align-items:stretch;padding:0 var(--pv-pad-x) 1rem;
  scroll-snap-type:x proximity;scroll-padding-left:var(--pv-pad-x);-webkit-overflow-scrolling:touch}
.kuroobi-scrollbar-hide::-webkit-scrollbar{display:none}
.kuroobi-scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
.pv-arrow{position:absolute;top:calc(50% - .5rem);transform:translateY(-50%);width:44px;height:44px;border-radius:50%;
  border:1px solid var(--pv-edge-2);background:rgba(8,8,10,.85);color:#fff;display:none;place-items:center;
  cursor:pointer;z-index:2;box-shadow:0 10px 26px rgba(0,0,0,.6);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:0;
  transition:opacity .25s ease,border-color .25s ease,color .25s ease}
.pv-arrow--l{left:.7rem}.pv-arrow--r{right:.7rem}
.pv-arrow:hover{border-color:rgba(255,183,3,.55);color:var(--pv-gold)}
@media (hover:hover) and (min-width:900px){
  .pv-arrow{display:grid;pointer-events:auto}
  .pv-railwrap:hover .pv-arrow,.pv-arrow:focus-visible{opacity:1}
}

/* ── Folder card ── */
.pv-fcard{position:relative;overflow:hidden;display:flex;flex-direction:column;width:100%;text-align:left;
  cursor:pointer;color:#fff;padding:1.2rem 1.2rem 1.15rem;border-radius:20px;border:1px solid var(--pv-edge);
  background:linear-gradient(165deg,rgba(255,255,255,.055),rgba(255,255,255,.01));-webkit-tap-highlight-color:transparent;
  transition:border-color .25s ease,box-shadow .35s ease}
.pv-fcard::before{content:'';position:absolute;top:0;right:0;bottom:0;left:0;
  background:radial-gradient(130% 100% at 100% 0%,rgba(255,183,3,.09),transparent 55%);
  opacity:0;transition:opacity .3s ease;pointer-events:none}
.pv-fcard:hover{border-color:rgba(255,183,3,.32);box-shadow:0 20px 44px rgba(0,0,0,.55)}
.pv-fcard:hover::before{opacity:1}
.pv-fcard-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.05rem}
.pv-fcard-ic{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;
  background:rgba(255,183,3,.1);border:1px solid rgba(255,183,3,.24);color:var(--pv-gold);
  box-shadow:0 6px 18px rgba(255,183,3,.08)}
.pv-fcard-go{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;
  border:1px solid var(--pv-edge);background:rgba(255,255,255,.04);color:var(--pv-dimmer);
  transition:background .25s,border-color .25s,color .25s,transform .3s cubic-bezier(.16,1,.3,1)}
.pv-fcard:hover .pv-fcard-go{background:var(--pv-gold);border-color:var(--pv-gold);color:#000;transform:translateX(3px)}
.pv-fcard-name{font-family:var(--pv-heading);font-size:1.08rem;font-weight:800;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-fcard-meta{margin-top:.35rem;font-size:.8rem;color:var(--pv-dim);line-height:1.4}
.pv-fprog{margin-top:1.05rem}
.pv-fprog-track{height:5px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
.pv-fprog-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#ffb703,#ffc93d);
  box-shadow:0 0 10px rgba(255,183,3,.45);transition:width .7s cubic-bezier(.16,1,.3,1)}
.pv-fprog-fill--full{background:linear-gradient(90deg,#1fa88f,var(--pv-jade));box-shadow:0 0 10px rgba(45,212,191,.4)}
.pv-fprog-lbl{display:flex;justify-content:space-between;margin-top:.5rem;font-size:.7rem;font-weight:750;color:var(--pv-dimmer)}
.pv-fprog-lbl b{color:var(--pv-dim);font-weight:800}

/* ── Video tile ── */
.pv-tap{-webkit-tap-highlight-color:transparent}
.pv-focus:focus-visible{outline:2px solid var(--pv-gold);outline-offset:2px}
.pv-tile{position:relative;display:block;width:100%;aspect-ratio:16/9;padding:0;border-radius:18px;overflow:hidden;
  border:1px solid rgba(255,255,255,.09);background:#0b0b0e;color:#fff;cursor:pointer;text-align:left;
  box-shadow:0 12px 30px rgba(0,0,0,.45);-webkit-tap-highlight-color:transparent;
  transition:border-color .25s ease,box-shadow .35s ease}
.pv-tile:hover{border-color:rgba(255,255,255,.22);box-shadow:0 22px 48px rgba(0,0,0,.6)}
.pv-tile--locked{cursor:not-allowed}
.pv-tile--done{border-color:rgba(45,212,191,.28)}
.pv-tile-scrim{position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none;
  background:linear-gradient(to top,rgba(0,0,0,.9) 0%,rgba(0,0,0,.28) 46%,transparent 68%),
             linear-gradient(to bottom,rgba(0,0,0,.42),transparent 30%)}
.pv-chipdur{position:absolute;top:.75rem;right:.75rem;display:inline-flex;align-items:center;gap:.32rem;
  padding:.32rem .65rem;border-radius:999px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.16);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-size:.7rem;font-weight:750}
.pv-badgedone{position:absolute;top:.7rem;left:.7rem;width:30px;height:30px;border-radius:50%;display:grid;
  place-items:center;background:rgba(45,212,191,.16);border:1px solid rgba(45,212,191,.45);color:var(--pv-jade);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(0,0,0,.4)}
.pv-playbtn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;
  display:grid;place-items:center;background:rgba(10,10,12,.5);border:1px solid rgba(255,255,255,.28);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;pointer-events:none;
  transition:transform .35s cubic-bezier(.34,1.56,.64,1),background .25s ease,color .25s ease,border-color .25s ease}
.pv-tile:hover .pv-playbtn{transform:translate(-50%,-50%) scale(1.1);background:var(--pv-gold);border-color:var(--pv-gold);color:#000}
@media (hover:none){.pv-playbtn{width:44px;height:44px;background:rgba(0,0,0,.4)}}
.pv-lockov{position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;background:rgba(0,0,0,.25);color:rgba(255,255,255,.75)}
.pv-tileinfo{position:absolute;left:1rem;right:1rem;bottom:.95rem;pointer-events:none}
.pv-tiletitle{font-weight:800;line-height:1.28;font-size:.95rem;text-shadow:0 2px 10px rgba(0,0,0,.85);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pv-rail .pv-tiletitle{font-size:.82rem}
.pv-tilemeta{display:flex;align-items:center;gap:.4rem;margin-top:.32rem;font-size:.73rem;color:rgba(255,255,255,.6)}
.pv-tilebar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.15)}
.pv-tilebar i{display:block;height:100%;background:linear-gradient(90deg,var(--pv-gold),var(--pv-crimson));
  box-shadow:0 0 12px rgba(255,183,3,.55)}

/* ── Photo guide card ── */
.pv-ph{display:block;color:#fff;text-decoration:none;-webkit-tap-highlight-color:transparent}
.pv-ph-frame{position:relative;aspect-ratio:4/3;border-radius:16px;overflow:hidden;border:1px solid var(--pv-edge);
  background:#0b0b0e;transition:border-color .25s ease,box-shadow .35s ease,transform .35s cubic-bezier(.16,1,.3,1)}
.pv-ph:hover .pv-ph-frame{border-color:rgba(255,183,3,.35);transform:translateY(-3px);box-shadow:0 16px 34px rgba(0,0,0,.5)}
.pv-ph-img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.16,1,.3,1)}
.pv-ph:hover .pv-ph-img{transform:scale(1.06)}
.pv-ph-zoom{position:absolute;right:.6rem;bottom:.6rem;width:30px;height:30px;border-radius:9px;display:grid;
  place-items:center;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
  color:#fff;opacity:0;transition:opacity .25s ease;pointer-events:none}
.pv-ph:hover .pv-ph-zoom{opacity:1}
.pv-ph-cap{margin-top:.6rem;font-weight:800;font-size:.92rem;line-height:1.35}
.pv-ph-desc{margin-top:.15rem;font-size:.78rem;color:var(--pv-dim)}

/* ── Folder view ── */
.pv-folderview>*+*{margin-top:2.4rem}
.pv-fhead{padding:max(1.4rem,env(safe-area-inset-top)) var(--pv-pad-x) 0}
.pv-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem;margin-bottom:1.1rem}
.pv-crumb{display:inline-flex;align-items:center;gap:.35rem;padding:.44rem .9rem;border-radius:999px;
  border:1px solid var(--pv-edge);background:var(--pv-surface);color:var(--pv-dim);font-size:.78rem;font-weight:750;
  cursor:pointer;transition:color .2s,border-color .2s,background .2s;-webkit-tap-highlight-color:transparent}
.pv-crumb:hover{color:#fff;border-color:var(--pv-edge-2);background:var(--pv-surface-2)}
.pv-crumb--home{color:var(--pv-gold);border-color:rgba(255,183,3,.28);background:rgba(255,183,3,.07)}
.pv-crumb--home:hover{color:#ffd34d;border-color:rgba(255,183,3,.5);background:rgba(255,183,3,.12)}
.pv-crumb-here{padding:.44rem .2rem;color:#fff;font-weight:850;font-size:.86rem}
.pv-crumb-sep{color:rgba(255,255,255,.22);font-size:.8rem}
.pv-fhead-title{margin:.2rem 0 0;font-family:var(--pv-heading);font-size:clamp(1.9rem,5.4vw,2.9rem);font-weight:900;
  letter-spacing:-.025em;line-height:1.08;
  background:linear-gradient(180deg,#fff 30%,rgba(255,255,255,.6) 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.pv-fhead-desc{margin:.7rem 0 0;max-width:760px;color:var(--pv-dim);line-height:1.65}
.pv-fchips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.15rem}
.pv-fchip{display:inline-flex;align-items:center;gap:.42rem;padding:.42rem .85rem;border-radius:999px;
  border:1px solid var(--pv-edge);background:var(--pv-surface);font-size:.76rem;font-weight:750;color:var(--pv-dim)}
.pv-fchip svg{color:var(--pv-gold)}
.pv-fchip--jade svg{color:var(--pv-jade)}

/* ── States ── */
.pv-alertwrap{max-width:1440px;margin:0 auto;padding:1.5rem var(--pv-pad-x) 0}
.pv-alertbox{padding:1.4rem 1.5rem;border-radius:18px;background:rgba(214,40,40,.08);
  border:1px solid rgba(214,40,40,.3);color:#ffb4b4;font-weight:750}
.pv-empty{position:relative;z-index:1;min-height:55vh;display:grid;place-items:center;padding:2rem var(--pv-pad-x)}
.pv-empty-panel{position:relative;overflow:hidden;text-align:center;max-width:460px;padding:3rem 2.25rem;
  border-radius:26px;border:1px solid var(--pv-edge);
  background:linear-gradient(170deg,rgba(255,255,255,.045),rgba(255,255,255,.008))}
.pv-empty-panel::before{content:'稽古';position:absolute;top:-1.5rem;right:-1rem;font-family:var(--pv-heading);
  font-size:9rem;font-weight:900;color:#fff;opacity:.02;line-height:1;user-select:none;pointer-events:none}
.pv-empty-ic{width:84px;height:84px;margin:0 auto 1.4rem;border-radius:50%;display:grid;place-items:center;
  background:rgba(255,255,255,.04);border:1px solid var(--pv-edge);color:var(--pv-dimmer)}
.pv-empty-title{margin:0;font-family:var(--pv-heading);font-size:1.6rem;font-weight:850;color:#fff}
.pv-empty-text{margin:.7rem auto 0;color:var(--pv-dim);line-height:1.6;max-width:360px}
.pv-nomatch{padding:.5rem var(--pv-pad-x) 0;margin:0;color:var(--pv-dim);text-align:center}
.pv-nomatch button{border:0;background:none;color:var(--pv-gold);font-weight:800;cursor:pointer;
  text-decoration:underline;text-underline-offset:3px;font-size:inherit;padding:.2rem}

/* ── Player overlay ── */
.pv-player{position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#000;display:flex;flex-direction:column}
/* Static header row: the lesson title lives in the bar itself so it can
   never be scrolled or pushed out of view on any screen or orientation. */
.pv-pbar{position:relative;z-index:10;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
  gap:.6rem;padding:max(.65rem,env(safe-area-inset-top)) clamp(.9rem,2.5vw,1.5rem) .65rem;
  background:#000;border-bottom:1px solid rgba(255,255,255,.07)}
.pv-chipbtn{display:inline-flex;align-items:center;gap:.45rem;min-height:40px;padding:.4rem .9rem;
  border-radius:999px;border:1px solid var(--pv-edge-2);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;
  font-weight:800;font-size:.86rem;white-space:nowrap;
  transition:background .2s ease,border-color .2s ease}
.pv-chipbtn:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.3)}
.pv-chipbtn--on{background:rgba(45,212,191,.16);border-color:rgba(45,212,191,.5)}
.pv-ptitlewrap{flex:1;min-width:0;text-align:center}
.pv-ptitle{margin:0;color:#fff;font-family:var(--pv-heading);
  font-size:clamp(.92rem,.88rem+.35vw,1.15rem);font-weight:800;line-height:1.28;letter-spacing:-.01em;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pv-viewer{--pv-chrome:8.5rem;flex:1;width:100%;min-height:0;display:flex;justify-content:center;
  overflow-y:auto;overscroll-behavior:contain;
  padding:1.25rem var(--pv-pad-x) max(1.25rem,env(safe-area-inset-bottom))}
.pv-pcol{width:100%;display:flex;flex-direction:column;gap:1.1rem;margin-top:auto;margin-bottom:auto}
.pv-pcol--wide{max-width:min(1280px,calc((100vh - var(--pv-chrome)) * 16 / 9));
  max-width:min(1280px,calc((100dvh - var(--pv-chrome)) * 16 / 9))}
.pv-pcol--short{max-width:min(440px,calc((100vh - var(--pv-chrome)) * 9 / 16));
  max-width:min(440px,calc((100dvh - var(--pv-chrome)) * 9 / 16))}
.pv-pmeta{display:flex;flex-wrap:wrap;justify-content:center;gap:.45rem}
.pv-pbox{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:clamp(12px,2vw,24px);
  border:1px solid rgba(255,255,255,.12);background:#000;box-shadow:0 25px 70px rgba(0,0,0,.85)}
.pv-pbox--short{aspect-ratio:9/16}
.pv-note{position:relative;border-radius:20px;border:1px solid rgba(255,183,3,.2);
  background:linear-gradient(160deg,rgba(255,183,3,.06),rgba(20,20,23,.92) 45%);padding:1.25rem 1.5rem;color:#fff;
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.pv-note-tag{display:flex;align-items:center;gap:.5rem;color:var(--pv-gold);font-size:.72rem;font-weight:850;
  letter-spacing:.14em;text-transform:uppercase}
.pv-note-dot{width:7px;height:7px;border-radius:50%;background:var(--pv-gold);box-shadow:0 0 12px var(--pv-gold)}
.pv-note p{margin:.65rem 0 0;color:rgba(255,255,255,.85);line-height:1.65;white-space:pre-wrap;font-size:.95rem}

/* ── Entrance motion ── */
@keyframes pv-rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
.pv-rise{opacity:0;animation:pv-rise .65s cubic-bezier(.16,1,.3,1) forwards}

/* ---------- Breakpoints ---------- */
@media (max-width:640px){
  .pv-hero{padding-top:max(env(safe-area-inset-top),clamp(2rem,6vw,2.75rem))}
  .pv-hero-kanji{top:auto;bottom:-2.5rem;transform:none;opacity:.025}
  .pv-shell{gap:2.4rem}
  .pv-grid{gap:1rem}
  /* Inside folders every video owns the full viewport width */
  .pv-grid-videos{grid-template-columns:1fr;gap:1.35rem}
  .pv-grid-folders{grid-template-columns:1fr}
  .pv-grid-photos{grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
  .pv-tile{border-radius:16px}
  .pv-grid-videos .pv-tileinfo{left:1.1rem;right:1.1rem;bottom:1.05rem}
  .pv-grid-videos .pv-tiletitle{font-size:1.05rem}
  .pv-grid-videos .pv-playbtn{width:52px;height:52px}
  .pv-note{padding:1rem 1.1rem;border-radius:16px}
  .pv-folderview>*+*{margin-top:2rem}
}
@media (max-width:380px){
  .pv-grid{gap:.8rem}
  .pv-grid-videos .pv-tiletitle{font-size:.98rem}
  .pv-stats{gap:.6rem}
  .pv-stat{padding:.7rem .9rem;gap:.6rem}
  .pv-stat-ic{width:36px;height:36px;border-radius:10px}
  .pv-stat-val{font-size:1.15rem}
  .pv-stat-lbl{font-size:.55rem;letter-spacing:.1em}
  .pv-pbar{gap:.4rem}
  .pv-chipbtn{padding:.3rem .6rem}
}
@media (orientation:landscape) and (max-height:500px){
  .pv-pbar{padding-top:.4rem;padding-bottom:.4rem;gap:.5rem}
  .pv-chipbtn{min-height:34px;padding:.3rem .75rem;font-size:.78rem}
  .pv-ptitle{-webkit-line-clamp:1;font-size:.85rem}
  .pv-viewer{--pv-chrome:5.5rem;padding-top:.75rem;padding-bottom:.75rem}
  .pv-pcol{gap:.75rem}
}
@media (prefers-reduced-motion:reduce){
  .pv-rise{animation:none;opacity:1}
  .pv-tile,.pv-fcard,.pv-ph-frame,.pv-ph-img,.pv-playbtn,.pv-fprog-fill{transition:none !important}
}
`

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
  const [isLoading, setIsLoading] = useState(() => !initialLibrary)
  const [error, setError] = useState('')
  const [playingVideo, setPlayingVideo] = useState(null)
  const [activeFolder, setActiveFolder] = useState(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [recentCutoff, setRecentCutoff] = useState(() => initialLibrary?.recentCutoff || '')
  const viewerScrollRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function fetchPortalVideos() {
      if (!initialPayload) setIsLoading(true)
      if (!initialPayload) setError('')

      try {
        const videosRes = await fetch('/api/portal/videos', { cache: 'no-store' })

        if (videosRes.status === 401) {
          redirectToCurrentPortalLogin()
          return
        }

        if (!videosRes.ok) throw new Error('Unable to load training videos.')

        const videosPayload = await videosRes.json()

        if (!cancelled) {
          const nextLibrary = normaliseLibraryPayload(videosPayload)
          setFolders(nextLibrary.folders)
          setUnfiledVideos(nextLibrary.unfiledVideos)
          setUnfiledPhotos(nextLibrary.unfiledPhotos)
          setProgressData(nextLibrary.progressData)
          setRecentCutoff(nextLibrary.recentCutoff)
        }
      } catch (loadError) {
        if (!cancelled && !initialPayload) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load training videos.')
        }
      } finally {
        if (!cancelled && !initialPayload) setIsLoading(false)
      }
    }

    void fetchPortalVideos()
    return () => {
      cancelled = true
    }
  }, [initialPayload])

  useEffect(() => {
    if (playingVideo) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [activeFolder?.id])

  const progressByVideoId = useMemo(() => {
    return new Map(progressData.map((entry) => [String(entry.videoId), entry]))
  }, [progressData])

  const videos = useMemo(() => [...folders.flatMap((folder) => folder.videos), ...unfiledVideos], [folders, unfiledVideos])
  const hasContent = Boolean(videos.length || folders.some((folder) => folder.photos?.length) || unfiledPhotos.length)

  const continueTraining = useMemo(() => {
    return videos
      .map((video) => ({ ...video, progress: progressByVideoId.get(video.id) }))
      .filter((video) => {
        const percent = Number(video.progress?.progressPercent || 0)
        return percent > 0 && percent < 100
      })
      .sort((a, b) => new Date(b.progress?.lastWatchedAt || 0).getTime() - new Date(a.progress?.lastWatchedAt || 0).getTime())
  }, [progressByVideoId, videos])

  const recentVideos = useMemo(() => {
    return [...videos]
      .filter((video) => !recentCutoff || new Date(video.createdAt || 0).getTime() >= new Date(recentCutoff).getTime())
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      .slice(0, 12)
  }, [recentCutoff, videos])

  const libraryStats = useMemo(() => {
    let completed = 0
    let inProgress = 0
    videos.forEach((video) => {
      const percent = Number(progressByVideoId.get(video.id)?.progressPercent || 0)
      if (percent >= 100) completed += 1
      else if (percent > 0) inProgress += 1
    })
    return { folders: folders.length, videos: videos.length, completed, inProgress }
  }, [folders.length, progressByVideoId, videos])

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

  async function saveProgress(videoId, progressPercent) {
    const safeProgress = Math.max(0, Math.min(100, Math.round(progressPercent)))
    setProgressData((current) => {
      const existing = current.find((entry) => String(entry.videoId) === String(videoId))
      const nextEntry = {
        videoId,
        progressPercent: safeProgress,
        completed: safeProgress >= 100,
        lastWatchedAt: new Date().toISOString(),
      }
      return existing
        ? current.map((entry) => String(entry.videoId) === String(videoId) ? nextEntry : entry)
        : [nextEntry, ...current]
    })

    try {
      await fetch('/api/portal/videos/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, progressPercent: safeProgress }),
      })
    } catch {
      // Keep local progress responsive
    }
  }

  function toggleCompletion(video) {
    const current = Number(progressByVideoId.get(video.id)?.progressPercent || 0)
    void saveProgress(video.id, current >= 100 ? 0 : 100)
  }

  async function copyLessonLink(video) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/portal/videos/${encodeURIComponent(video.id)}`)
    } catch {
      // Convenience action
    }
  }

  function closePlayerToLibrary() {
    setPlayingVideo(null)
    setActiveFolder(null)
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

  return (
    <SecureContentWrapper>
      <PortalNoticePopup />
      <MotionConfig reducedMotion="user">
      {isLoading ? (
        <VideosPageSkeleton />
      ) : (
      <div className="pv-root">
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: PRACTICE_LIBRARY_CSS }} />

        {/* Amber ambient signature — the practice-library variant of the portal aura */}
        <div className="pv-aura" aria-hidden="true" />
        <div className="pv-aura-side" aria-hidden="true" />
        <div className="pv-aura-deep" aria-hidden="true" />

        {!activeFolder ? (
          <header className="pv-hero">
            <span className="pv-hero-kanji" aria-hidden="true">稽古</span>
            <h1 className="pv-hero-title pv-rise" style={{ animationDelay: '0.05s' }}>
              Home <b>Practice</b> Library
            </h1>
            <p className="pv-hero-copy pv-rise" style={{ animationDelay: '0.12s' }}>
              Explore personally assigned karate drills, syllabus videos, and technique photo guides to refine your martial arts practice.
            </p>

            {!error && hasContent ? (
              <div className="pv-stats pv-rise" style={{ animationDelay: '0.2s' }}>
                <div className="pv-stat">
                  <span className="pv-stat-ic pv-stat-ic--gold"><Layers size={19} /></span>
                  <span>
                    <span className="pv-stat-val">{libraryStats.folders}</span>
                    <span className="pv-stat-lbl">Practice Folders</span>
                  </span>
                </div>
                <div className="pv-stat">
                  <span className="pv-stat-ic pv-stat-ic--neutral"><PlayCircle size={19} /></span>
                  <span>
                    <span className="pv-stat-val">{libraryStats.videos}</span>
                    <span className="pv-stat-lbl">Training Videos</span>
                  </span>
                </div>
                <div className="pv-stat">
                  <span className="pv-stat-ic pv-stat-ic--red"><TrendingUp size={19} /></span>
                  <span>
                    <span className="pv-stat-val">{libraryStats.inProgress}</span>
                    <span className="pv-stat-lbl">In Progress</span>
                  </span>
                </div>
                <div className="pv-stat">
                  <span className="pv-stat-ic pv-stat-ic--jade"><CheckCircle2 size={19} /></span>
                  <span>
                    <span className="pv-stat-val">{libraryStats.completed}</span>
                    <span className="pv-stat-lbl">Completed</span>
                  </span>
                </div>
              </div>
            ) : null}

            <div className="pv-searchwrap pv-rise" style={{ animationDelay: '0.28s' }}>
              <Search size={18} className="pv-searchicon" />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search techniques, drills, or folders..."
                aria-label="Search practice library"
                className="pv-search"
              />
              {libraryQuery ? (
                <button
                  type="button"
                  onClick={() => setLibraryQuery('')}
                  className="pv-clear pv-tap pv-focus"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </header>
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
              <h2 className="pv-empty-title">No Practice Videos Found</h2>
              <p className="pv-empty-text">Your branch practice library is empty or content is currently hidden.</p>
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
                      onClick={() => setActiveFolder(null)}
                      className="pv-crumb pv-crumb--home pv-tap pv-focus"
                    >
                      <ChevronLeft size={14} /> Home Practice
                    </button>
                    {folderBreadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={crumb.id}>
                        <span className="pv-crumb-sep" aria-hidden="true">/</span>
                        {idx === folderBreadcrumbs.length - 1 ? (
                          <span className="pv-crumb-here">{crumb.title}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActiveFolder(crumb)}
                            className="pv-crumb pv-tap pv-focus"
                          >
                            {crumb.title}
                          </button>
                        )}
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

                <FolderRail title="Subfolders" folders={childFolders} allFolders={folders} progressByVideoId={progressByVideoId} onOpen={setActiveFolder} />
                <VideoRow title="Videos" icon={<PlayCircle size={17} />} videos={activeFolder.videos} progressByVideoId={progressByVideoId} onPlay={setPlayingVideo} />
                <PhotoRow title="Photo Guides" photos={activeFolder.photos || []} />
              </section>
            ) : (
              <>
                <VideoRow
                  title="Continue Training"
                  icon={<History size={17} />}
                  videos={libraryQuery ? continueTraining.filter((video) => String(video.title).toLowerCase().includes(libraryQuery.trim().toLowerCase())) : continueTraining}
                  progressByVideoId={progressByVideoId}
                  onPlay={setPlayingVideo}
                  compact
                />
                {!libraryQuery ? <VideoRow title="Recently Added" icon={<Sparkles size={17} />} videos={recentVideos} progressByVideoId={progressByVideoId} onPlay={setPlayingVideo} compact /> : null}
                <FolderRail folders={rootFolders} allFolders={searchedLibrary.folders} progressByVideoId={progressByVideoId} onOpen={setActiveFolder} />

                <VideoRow title="General Videos" icon={<PlayCircle size={17} />} videos={searchedLibrary.unfiledVideos} progressByVideoId={progressByVideoId} onPlay={setPlayingVideo} />
                <PhotoRow title="Photo Guides" photos={searchedLibrary.unfiledPhotos} />
                {libraryQuery && !searchedLibrary.folders.length && !searchedLibrary.unfiledVideos.length && !searchedLibrary.unfiledPhotos.length ? (
                  <p className="pv-nomatch">
                    No practice content matches “{libraryQuery}”.{' '}
                    <button type="button" className="pv-tap pv-focus" onClick={() => setLibraryQuery('')}>Clear search</button>
                  </p>
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
                className="pv-player"
              >
                {/* Fixed header — the lesson title always stays visible here */}
                <header className="pv-pbar">
                  <button type="button" onClick={closePlayerToLibrary} className="pv-chipbtn pv-tap pv-focus">
                    <ChevronLeft size={20} /> Back
                  </button>
                  <div className="pv-ptitlewrap">
                    <h1 className="pv-ptitle">{playingVideo.title}</h1>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => toggleCompletion(playingVideo)}
                      className={`pv-chipbtn pv-tap pv-focus ${Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0) >= 100 ? 'pv-chipbtn--on' : ''}`}
                    >
                      <CheckCircle2 size={16} color={Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0) >= 100 ? '#2dd4bf' : '#fff'} />
                      <span className="practice-complete-label">{Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0) >= 100 ? 'Completed' : 'Complete'}</span>
                    </button>
                    <button type="button" onClick={() => copyLessonLink(playingVideo)} className="pv-chipbtn pv-tap pv-focus">
                      <Copy size={16} /> <span className="practice-copy-label">Share</span>
                    </button>
                  </div>
                </header>

                <div ref={viewerScrollRef} className="pv-viewer">
                  <div className={`pv-pcol ${playingVideo.contentFormat === 'short' ? 'pv-pcol--short' : 'pv-pcol--wide'}`}>
                    <div className={`pv-pbox ${playingVideo.contentFormat === 'short' ? 'pv-pbox--short' : ''}`}>
                      <YouTubeNativePlayer
                        youtubeId={playingVideo.youtubeId}
                        title={playingVideo.title}
                        posterUrl={playingVideo.thumbnail}
                        initialProgressPercent={Number(progressByVideoId.get(playingVideo.id)?.progressPercent || 0)}
                        contentFormat={playingVideo.contentFormat}
                        onProgress={({ progressPercent }) => saveProgress(playingVideo.id, progressPercent)}
                        onEscape={closePlayerToLibrary}
                      />
                    </div>
                    {playingVideo.category || playingVideo.duration ? (
                      <div className="pv-pmeta">
                        {playingVideo.category ? <span className="pv-fchip">{formatCategoryLabel(playingVideo.category)}</span> : null}
                        {playingVideo.duration ? <span className="pv-fchip"><Clock size={13} /> {playingVideo.duration}</span> : null}
                      </div>
                    ) : null}
                    {playingVideo.lessonNote ? (
                      <aside className="pv-note">
                        <div className="pv-note-tag">
                          <span className="pv-note-dot" /> Instructor Note
                        </div>
                        <p>{playingVideo.lessonNote}</p>
                      </aside>
                    ) : null}
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

function FolderRail({ folders, allFolders, progressByVideoId, onOpen, title = 'Practice Folders' }) {
  if (!folders.length) return null
  return (
    <Shelf>
      <SectionHead icon={<FolderOpen size={17} />} title={title} />
      <div className="pv-grid pv-grid-folders">
        {folders.map((folder) => {
          const subfolderCount = (allFolders || []).filter((candidate) => candidate.parentFolderId === folder.id).length
          const totalItems = folder.videos.length + (folder.photos?.length || 0)
          const completedCount = folder.videos.filter((video) => Number(progressByVideoId.get(video.id)?.progressPercent || 0) >= 100).length
          const percent = folder.videos.length ? Math.round((completedCount / folder.videos.length) * 100) : 0

          return (
            <motion.button
              key={folder.id}
              type="button"
              onClick={() => onOpen(folder)}
              aria-label={`Open folder ${folder.title}`}
              className="pv-fcard pv-tap pv-focus"
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.985 }}
            >
              <div className="pv-fcard-top">
                <span className="pv-fcard-ic"><Folder size={23} strokeWidth={2} /></span>
                <span className="pv-fcard-go"><ArrowRight size={16} /></span>
              </div>
              <div className="pv-fcard-name">{folder.title}</div>
              <div className="pv-fcard-meta">
                {[subfolderCount ? `${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'}` : '', `${totalItems} item${totalItems === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
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
            </motion.button>
          )
        })}
      </div>
    </Shelf>
  )
}

function PhotoRow({ title, photos }) {
  if (!photos.length) return null
  return (
    <Shelf>
      <SectionHead icon={<ImageIcon size={17} />} title={title} />
      <div className="pv-grid pv-grid-photos">
        {photos.map((photo) => (
          <a key={photo.id} href={photo.imageUrl} target="_blank" rel="noreferrer" className="pv-ph pv-tap">
            <div className="pv-ph-frame">
              <img className="pv-ph-img" src={photo.imageUrl} alt={photo.title} loading="lazy" decoding="async" />
              <span className="pv-ph-zoom"><Maximize2 size={14} /></span>
            </div>
            <div className="pv-ph-cap">{photo.title}</div>
            {photo.description ? <div className="pv-ph-desc">{photo.description}</div> : null}
          </a>
        ))}
      </div>
    </Shelf>
  )
}

function VideoRow({ title, icon, videos, progressByVideoId, onPlay, compact = false }) {
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
function VideoTile({ video, progressByVideoId, onPlay, variant, sizes }) {
  const compact = variant === 'rail'
  const progress = Number(progressByVideoId.get(video.id)?.progressPercent || 0)
  const isDone = progress >= 100

  return (
    <motion.button
      type="button"
      onClick={() => !video.locked && onPlay(video)}
      className={`pv-tap pv-focus pv-tile${isDone ? ' pv-tile--done' : ''}${video.locked ? ' pv-tile--locked' : ''}`}
      whileHover={!video.locked ? { y: -4, scale: 1.01 } : undefined}
      whileTap={!video.locked ? { scale: 0.97 } : undefined}
      style={{
        flex: compact ? '0 0 clamp(230px, 64vw, 330px)' : undefined,
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

      {isDone ? (
        <span title="Completed" aria-label="Completed" className="pv-badgedone">
          <CheckCircle2 size={16} />
        </span>
      ) : null}

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
