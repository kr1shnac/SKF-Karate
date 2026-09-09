'use client'

import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Lock,
  LogOut,
  PlayCircle,
  Settings2,
} from 'lucide-react'

/**
 * Practice Manager — drag-and-drop ordering + audience control for the
 * athlete practice library, served from the website instead of FeeTrack.
 * Reorders persist through the staff-session API, which writes sort_order
 * and purges portal caches so athletes see the new order immediately.
 */

function reorderGroup(group, from, to) {
  const next = [...group]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Full depth-first pre-order of every folder id (roots → leaves). */
function flattenTreeChildren(childrenMap, parentId = null) {
  const ids = []
  const visit = (pid) => {
    for (const id of childrenMap.get(pid) || []) {
      ids.push(id)
      visit(id)
    }
  }
  visit(parentId)
  return ids
}

/** Every id in the scoped scope, grouped by folder pre-order. */
function flattenScopedOrder(scope, folders, videos, photos) {
  if (scope === 'folders') return flattenTreeChildren(folders)
  const map = scope === 'videos' ? videos : photos
  const ids = []
  for (const folderId of flattenTreeChildren(folders)) ids.push(...(map.get(folderId) || []))
  ids.push(...(map.get(null) || []))
  return ids
}

function MoveButtons({ itemIds, index, onReorder }) {
  return (
    <div className="pmc-move">
      <button
        type="button"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => onReorder(reorderGroup(itemIds, index, index - 1))}
        className="pmc-movebtn"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={index === itemIds.length - 1}
        onClick={() => onReorder(reorderGroup(itemIds, index, index + 1))}
        className="pmc-movebtn"
      >
        <ChevronDown size={14} />
      </button>
    </div>
  )
}

function ReorderList({ itemIds, renderCard, onReorder }) {
  const [dragged, setDragged] = useState(null)
  const [overId, setOverId] = useState(null)

  if (!itemIds.length) return null

  const drop = (targetId) => {
    if (dragged && dragged !== targetId) {
      onReorder(reorderGroup(itemIds, itemIds.indexOf(dragged), itemIds.indexOf(targetId)))
    }
    setDragged(null)
    setOverId(null)
  }

  return (
    <div className="pmc-list">
      {itemIds.map((id, index) => (
        <div
          key={id}
          className={`pmc-row${dragged === id ? ' pmc-row--dragging' : ''}${overId === id ? ' pmc-row--over' : ''}`}
        >
          <span
            className="pmc-grip"
            draggable
            onDragStart={(event) => {
              setDragged(id)
              setOverId(id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setOverId(id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              drop(id)
            }}
            onDragEnd={() => {
              setDragged(null)
              setOverId(null)
            }}
            role="button"
            aria-label="Drag to reorder"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' && index > 0) onReorder(reorderGroup(itemIds, index, index - 1))
              if (event.key === 'ArrowDown' && index < itemIds.length - 1) onReorder(reorderGroup(itemIds, index, index + 1))
            }}
          >
            <GripVertical size={16} />
          </span>
          {renderCard(id, index)}
          <MoveButtons itemIds={itemIds} index={index} onReorder={onReorder} />
        </div>
      ))}
    </div>
  )
}

function beltLabel(beltLevels) {
  const levels = Array.isArray(beltLevels) ? beltLevels.filter(Boolean) : []
  if (!levels.length || levels.length >= 11) return 'All belts'
  if (levels.length <= 4) return levels.join(' · ')
  return `${levels.length} belts`
}

function FolderCard({ folder }) {
  const [published, setPublished] = useState(Boolean(folder.isPublished))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!folder) return null

  async function togglePublish() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/manage/practice/folder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folder.id, isPublished: !published }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed')
      setPublished(!published)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pmc-fcard">
      <div className="pmc-fcard-main">
        <FolderOpen size={18} className="pmc-fcard-ic" />
        <div className="pmc-fcard-body">
          <div className="pmc-fcard-name">{folder.title}</div>
          <div className="pmc-fcard-sub">
            <span className="pmc-chip pmc-chip--open">Shelf — shows what its videos allow</span>
            {error ? <span className="pmc-error">{error}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className={`pmc-pub${published ? ' pmc-pub--on' : ''}`}
          onClick={togglePublish}
          disabled={saving}
          aria-label={published ? 'Hide folder' : 'Make folder visible'}
          title={published ? 'Folder is visible' : 'Folder is hidden'}
        >
          {saving ? <Loader2 size={13} className="pmc-spin" /> : published ? <Check size={13} /> : <Lock size={13} />}
          {published ? 'Visible' : 'Hidden'}
        </button>
      </div>
    </div>
  )
}

function VideoAudienceEditor({ video, branches, belts }) {
  const [branchSlugs, setBranchSlugs] = useState(buildSet(video.branchSlugs))
  const [batchNames, setBatchNames] = useState((video.batchNames || []).join(', '))
  const [belt, setBelt] = useState(buildSet(video.beltLevels))
  const [published, setPublished] = useState(Boolean(video.isPublished))
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    setDone(false)
    try {
      const res = await fetch('/api/manage/practice/video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          branchSlugs: [...branchSlugs],
          batchNames: batchNames.split(',').map((s) => s.trim()).filter(Boolean),
          beltLevels: [...belt],
          isPublished: published,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed')
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pmc-aud">
      <div className="pmc-aud-row">
        <label className="pmc-aud-title">Branches</label>
        <div className="pmc-aud-chips">
          {branches.map((branch) => (
            <button
              key={branch.slug}
              type="button"
              className={`pmc-tag${branchSlugs.has(branch.slug) ? ' pmc-tag--on' : ''}`}
              onClick={() => toggleSet(branchSlugs, setBranchSlugs, branch.slug)}
            >
              {branch.name}
            </button>
          ))}
        </div>
      </div>
      <div className="pmc-aud-row">
        <label className="pmc-aud-title">Batches</label>
        <input
          value={batchNames}
          onChange={(event) => setBatchNames(event.target.value)}
          placeholder="Comma-separated (empty = all batches)"
          className="pmc-input"
        />
      </div>
      <div className="pmc-aud-row">
        <label className="pmc-aud-title">Belts</label>
        <div className="pmc-aud-chips">
          {belts.map((beltName) => (
            <button
              key={beltName}
              type="button"
              className={`pmc-tag${belt.has(beltName) ? ' pmc-tag--on' : ''}`}
              onClick={() => toggleSet(belt, setBelt, beltName)}
            >
              {beltName}
            </button>
          ))}
        </div>
      </div>
      <div className="pmc-aud-row pmc-aud-row--inline">
        <button
          type="button"
          className={`pmc-pub${published ? ' pmc-pub--on' : ''}`}
          onClick={() => setPublished((v) => !v)}
        >
          {published ? <Check size={13} /> : <Lock size={13} />}
          {published ? 'Published' : 'Hidden'}
        </button>
        <button type="button" className="pmc-save" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="pmc-spin" /> : null}
          {done ? 'Saved' : 'Save'}
        </button>
        {error ? <span className="pmc-error">{error}</span> : null}
      </div>
      <p className="pmc-note-line">This video only shows for the belts, branches, and batches picked above. Folders never restrict it — they are just shelves.</p>
    </div>
  )
}

function ContentItem({ kind, video, photo }) {
  const title = kind === 'video' ? video?.title : photo?.title
  const sub = kind === 'video'
    ? [beltLabel(video?.beltLevels), video?.category, video?.durationLabel].filter(Boolean).join(' · ')
    : [beltLabel(photo?.beltLevels), photo?.description].filter(Boolean).join(' · ')
  return (
    <div className="pmc-icard">
      <span className={`pmc-icard-ic${kind === 'video' ? ' pmc-icard-ic--video' : ''}`}>
        {kind === 'video' ? <PlayCircle size={15} /> : <ImageIcon size={15} />}
      </span>
      <div className="pmc-icard-body">
        <div className="pmc-icard-title">{title}</div>
        {sub ? <div className="pmc-icard-sub">{sub}</div> : null}
      </div>
    </div>
  )
}

function VideoCard({ video, branches, belts }) {
  const [open, setOpen] = useState(false)
  if (!video) return null
  return (
    <div className="pmc-vcard">
      <div className="pmc-icard">
        <span className="pmc-icard-ic pmc-icard-ic--video">
          <PlayCircle size={15} />
        </span>
        <div className="pmc-icard-body">
          <div className="pmc-icard-title">{video.title}</div>
          <div className="pmc-icard-sub">
            {[beltLabel(video.beltLevels), video.category, video.durationLabel].filter(Boolean).join(' · ') || '\u00A0'}
          </div>
        </div>
        <button
          type="button"
          className="pmc-iconbtn"
          aria-label="Video targeting"
          title="Belt, branch & batch targeting"
          onClick={() => setOpen((v) => !v)}
        >
          <Settings2 size={15} />
        </button>
      </div>
      {open ? <VideoAudienceEditor video={video} branches={branches} belts={belts} /> : null}
    </div>
  )
}

function GroupShelf({ title, itemIds, renderCard, onReorder, emptyLabel }) {
  if (!itemIds.length && !emptyLabel) return null
  return (
    <div className="pmc-shelf">
      <div className="pmc-shelf-title">{title}</div>
      <ReorderList itemIds={itemIds} renderCard={renderCard} onReorder={onReorder} />
      {!itemIds.length && emptyLabel ? <p className="pmc-empty">{emptyLabel}</p> : null}
    </div>
  )
}

function FolderNode({ folderId, folderMap, videoById, photoById, order, branches, belts, onGroupReorder }) {
  const videoIds = order.videos.get(folderId) || []
  const photoIds = order.photos.get(folderId) || []
  return (
    <div className="pmc-col">
      <GroupShelf
        title="Videos"
        itemIds={videoIds}
        onReorder={(newGroup) => onGroupReorder('videos', folderId, newGroup)}
        renderCard={(id) => <VideoCard video={videoById.get(id)} branches={branches} belts={belts} />}
      />
      <GroupShelf
        title="Photo guides"
        itemIds={photoIds}
        onReorder={(newGroup) => onGroupReorder('photos', folderId, newGroup)}
        renderCard={(id) => <ContentItem kind="photo" photo={photoById.get(id)} />}
      />
      {order.folders.get(folderId)?.map((id) => (
        <FolderNode
          key={id}
          folderId={id}
          folderMap={folderMap}
          videoById={videoById}
          photoById={photoById}
          order={order}
          branches={branches}
          belts={belts}
          onGroupReorder={onGroupReorder}
        />
      ))}
    </div>
  )
}

export default function PracticeManager({ staff, videos, folders, photos, branches, belts }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [savingScope, setSavingScope] = useState('')
  const [order, setOrder] = useState(() => buildInitialOrder(folders, videos, photos))

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos])
  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  async function handleGroupReorder(scope, groupKey, newIds) {
    const foldersMap = new Map(order.folders)
    const videosMap = new Map(order.videos)
    const photosMap = new Map(order.photos)
    const target = scope === 'folders' ? foldersMap : scope === 'videos' ? videosMap : photosMap
    target.set(groupKey, newIds)
    setOrder({ folders: foldersMap, videos: videosMap, photos: photosMap })
    const orderedIds = flattenScopedOrder(scope, foldersMap, videosMap, photosMap)
    setSavingScope(scope)
    try {
      const res = await fetch('/api/manage/practice/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, orderedIds }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Reorder failed')
    } catch (err) {
      window.alert('Reorder failed: ' + err.message)
    } finally {
      setSavingScope('')
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginError('')
    try {
      const res = await fetch('/api/manage/practice/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Login failed')
      window.location.reload()
    } catch (err) {
      setLoginError(err.message)
    }
  }

  async function handleLogout() {
    await fetch('/api/manage/practice/logout', { method: 'POST' })
    window.location.reload()
  }

  if (!staff) {
    return (
      <div className="pmc-shell pmc-shell--login">
        <div className="pmc-login">
          <h1 className="pmc-login-title">Practice Manager</h1>
          <p className="pmc-login-sub">Reorder practice shelves and set video audiences for the athlete portal.</p>
          <form onSubmit={handleLogin} className="pmc-login-form">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Staff username"
              autoCapitalize="none"
              autoComplete="username"
              className="pmc-input"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              className="pmc-input"
            />
            {loginError ? <p className="pmc-error">{loginError}</p> : null}
            <button type="submit" className="pmc-login-btn">Sign in</button>
          </form>
        </div>
      </div>
    )
  }

  const rootFolderIds = order.folders.get(null) || []
  const unfiledVideoIds = order.videos.get(null) || []
  const unfiledPhotoIds = order.photos.get(null) || []

  return (
    <div className="pmc-shell">
      <header className="pmc-top">
        <div>
          <h1 className="pmc-title">Practice Manager</h1>
          <p className="pmc-sub">Shelves are just folders — every branch sees the same shelves. Each video only reaches the belts, branches, and batches you pick on it. Belt ordering: “All belts” first, then White → Black. Drag the grip (or use ↑↓) to reorder within the same belt.</p>
        </div>
        <div className="pmc-top-right">
          <span className="pmc-staff">{staff.name} · {staff.role}</span>
          {savingScope ? (
            <span className="pmc-saving"><Loader2 size={13} className="pmc-spin" /> Saving {savingScope}…</span>
          ) : null}
          <button type="button" onClick={handleLogout} className="pmc-logout"><LogOut size={14} /> Logout</button>
        </div>
      </header>

      <GroupShelf
        title="Folders & shelves"
        itemIds={rootFolderIds}
        onReorder={(newGroup) => handleGroupReorder('folders', null, newGroup)}
        renderCard={(id) => <FolderCard folder={folderMap.get(id)} />}
      />

      {rootFolderIds.map((id) => (
        <FolderNode
          key={id}
          folderId={id}
          folderMap={folderMap}
          videoById={videoById}
          photoById={photoById}
          order={order}
          branches={branches}
          belts={belts}
          onGroupReorder={handleGroupReorder}
        />
      ))}

      <GroupShelf
        title="Unfiled videos"
        itemIds={unfiledVideoIds}
        onReorder={(newGroup) => handleGroupReorder('videos', null, newGroup)}
        renderCard={(id) => <VideoCard video={videoById.get(id)} branches={branches} belts={belts} />}
        emptyLabel="Nothing outside a folder."
      />

      <GroupShelf
        title="Unfiled photo guides"
        itemIds={unfiledPhotoIds}
        onReorder={(newGroup) => handleGroupReorder('photos', null, newGroup)}
        renderCard={(id) => <ContentItem kind="photo" photo={photoById.get(id)} />}
        emptyLabel="Nothing outside a folder."
      />
    </div>
  )
}

function buildInitialOrder(folders, videos, photos) {
  const foldersMap = new Map()
  const videosMap = new Map()
  const photosMap = new Map()
  for (const folder of folders) {
    const key = folder.parentFolderId || null
    const list = foldersMap.get(key) || []
    list.push(folder.id)
    foldersMap.set(key, list)
  }
  for (const video of videos) {
    const key = video.folderId || null
    const list = videosMap.get(key) || []
    list.push(video.id)
    videosMap.set(key, list)
  }
  for (const photo of photos) {
    const key = photo.folderId || null
    const list = photosMap.get(key) || []
    list.push(photo.id)
    photosMap.set(key, list)
  }
  return { folders: foldersMap, videos: videosMap, photos: photosMap }
}

function buildSet(values) {
  return new Set((values || []).map((value) => String(value).trim()).filter(Boolean))
}

function toggleSet(set, setter, value) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  setter(next)
}