import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  CircleAlert,
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Bot,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Database,
  Eye,
  FileText,
  Gem,
  Heart,
  Menu,
  MessageSquareText,
  Package,
  Play,
  Plus,
  Save,
  Send,
  Settings2,
  Shield,
  Square,
  Trash2,
  Wifi,
  X,
  Zap
} from 'lucide-react'

type View = 'settings' | 'bot-settings' | 'chat' | 'information' | 'flat-surface' | 'viewer'
type BotSettings = {
  emergencyLeave: boolean
  autoEat: boolean
  fightMobs: boolean
  neverBreakTools: boolean
  greetPlayers: boolean
}
type FlatSurfaceJob = {
  id: number
  profileId: number
  type: 'flat_surface'
  name: string
  x1: number
  y1: number
  z1: number
  x2: number
  y2: number
  z2: number
  chestX: number
  chestY: number
  chestZ: number
  status: 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed'
  completedColumns: number
  totalColumns: number
  error: string | null
}
type ActiveJob = Pick<FlatSurfaceJob, 'id' | 'name' | 'status' | 'completedColumns' | 'totalColumns' | 'error'> & { minedBlocks?: number }
type FlatSurfaceDraft = Record<'name' | 'x1' | 'y1' | 'z1' | 'x2' | 'y2' | 'z2' | 'chestX' | 'chestY' | 'chestZ', string>
type Profile = {
  id: number
  name: string
  host: string
  port: number | null
  username: string
  authMode: 'microsoft' | 'offline'
  minecraftVersion: string
  botSettings: BotSettings
}
type Item = {
  slot: number
  name: string
  displayName: string
  count: number
  maxDurability: number
  durabilityUsed: number
  enchantments: { name: string; level: number }[]
}
type BotState = {
  connected: boolean
  connecting: boolean
  profileId: number | null
  profileName: string
  authCode: { userCode: string; verificationUri: string; expiresIn: number } | null
  chat: { time: string; message: string; position: string }[]
  logs: { time: string; level: string; message: string }[]
  health: number | null
  food: number | null
  level: number | null
  ping: number | null
  position: { x: number; y: number; z: number } | null
  dimension: string | null
  inventory: (Item | null)[]
  armor: { slot: number; label: string; item: Item | null }[]
  offhand: Item | null
  mainHand: Item | null
  activeJob: ActiveJob | null
  viewerEnabled: boolean
  viewerRunning: boolean
  viewerPort: number
}
type Draft = Pick<Profile, 'host' | 'port' | 'username' | 'authMode' | 'minecraftVersion' | 'botSettings'>
type IconRecord = { category_slug: string; subcategory_slug?: string | null; file_slug: string }
type Confirmation = {
  action: 'delete-profile' | 'clear-temporary-data' | 'start-job' | 'delete-job'
  title: string
  description: string
  confirmLabel: string
  jobId?: number
}
type ToastMessage = { message: string; tone: 'success' | 'error' }

const emptyBot: BotState = {
  connected: false,
  connecting: false,
  profileId: null,
  profileName: '',
  authCode: null,
  chat: [],
  logs: [],
  health: null,
  food: null,
  level: null,
  ping: null,
  position: null,
  dimension: null,
  inventory: [],
  armor: [],
  offhand: null,
  mainHand: null,
  activeJob: null,
  viewerEnabled: false,
  viewerRunning: false,
  viewerPort: 3001
}

const emptyFlatSurfaceDraft: FlatSurfaceDraft = {
  name: '',
  x1: '',
  y1: '',
  z1: '',
  x2: '',
  y2: '',
  z2: '',
  chestX: '',
  chestY: '',
  chestZ: ''
}

const navigation: { id: View; label: string; icon: typeof Settings2 }[] = [
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'bot-settings', label: 'Bot Settings', icon: Shield },
  { id: 'chat', label: 'Live Chat & Logs', icon: MessageSquareText },
  { id: 'information', label: 'Live Information', icon: Activity },
  { id: 'viewer', label: 'Live 3D View', icon: Eye }
]

const jobNavigation: { id: View; label: string; icon: typeof Settings2 }[] = [
  { id: 'flat-surface', label: 'Flat Surface', icon: Activity }
]

const defaultBotSettings: BotSettings = {
  emergencyLeave: false,
  autoEat: false,
  fightMobs: false,
  neverBreakTools: false,
  greetPlayers: false
}

const botSettingRows: { key: keyof BotSettings; title: string; detail: string; icon: typeof Shield }[] = [
  { key: 'emergencyLeave', title: 'Emergency leave', detail: 'Disconnect from the server when health falls below 4/20. The bot will not reconnect automatically.', icon: Heart },
  { key: 'autoEat', title: 'Auto eat to stay alive', detail: 'Eat available food automatically when hunger reaches 14/20 or lower.', icon: Zap },
  { key: 'fightMobs', title: 'Fight hostile mobs', detail: 'Defend against nearby zombies, skeletons, spiders, and other supported hostiles. Players, passive mobs, creepers, endermen, and wardens are ignored.', icon: Shield },
  { key: 'neverBreakTools', title: 'Never break tools', detail: 'Stop using and stow a held durable item when 10% durability or less remains.', icon: Settings2 },
  { key: 'greetPlayers', title: 'Greet nearby players', detail: 'Send a random greeting when a player comes within 5 blocks. Each player has a 10-minute cooldown.', icon: MessageSquareText }
]

async function api<T> (url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers
  })
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data?.error || data?.message || 'The request could not be completed.')
  return data as T
}

function normalizeItemName (value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function collectIconRecords (value: unknown, records: IconRecord[] = []): IconRecord[] {
  if (!value || typeof value !== 'object') return records
  if ('file_slug' in value && 'category_slug' in value) {
    records.push(value as IconRecord)
    return records
  }
  for (const child of Object.values(value)) collectIconRecords(child, records)
  return records
}

function formatTime (isoTime: string) {
  return new Date(isoTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function App () {
  const [database, setDatabase] = useState<'loading' | 'connected' | 'failed'>('loading')
  const [databaseEngine, setDatabaseEngine] = useState('PSQL')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [supportedVersions, setSupportedVersions] = useState<string[]>([])
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>({ host: '', port: null, username: '', authMode: 'microsoft', minecraftVersion: '1.21.5', botSettings: { ...defaultBotSettings } })
  const [bot, setBot] = useState<BotState>(emptyBot)
  const [view, setView] = useState<View>('settings')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [itemMenu, setItemMenu] = useState<number | null>(null)
  const [chatMessage, setChatMessage] = useState('')
  const [now, setNow] = useState(new Date())
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [iconRecords, setIconRecords] = useState<Record<string, IconRecord>>({})
  const [jobs, setJobs] = useState<FlatSurfaceJob[]>([])
  const [jobDraft, setJobDraft] = useState<FlatSurfaceDraft>({ ...emptyFlatSurfaceDraft })
  const [jobsBusy, setJobsBusy] = useState(false)
  const [jobsError, setJobsError] = useState('')
  const chatEnd = useRef<HTMLDivElement>(null)

  const activeProfile = profiles.find(profile => profile.id === activeProfileId) || null
  const activeView = [...navigation, ...jobNavigation].find(item => item.id === view)!
  const isDirty = Boolean(activeProfile && (
    draft.host !== activeProfile.host ||
    draft.port !== activeProfile.port ||
    draft.username !== activeProfile.username ||
    draft.authMode !== activeProfile.authMode ||
    draft.minecraftVersion !== activeProfile.minecraftVersion ||
    Object.keys(defaultBotSettings).some(key => draft.botSettings[key as keyof BotSettings] !== activeProfile.botSettings[key as keyof BotSettings])
  ))

  function notify (message: string, tone: ToastMessage['tone'] = 'success') {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3200)
  }

  async function loadProfiles () {
    const rows = await api<Profile[]>('/api/profiles')
    setProfiles(rows)
    const savedId = Number(window.localStorage.getItem('active-profile-id'))
    const selected = rows.find(profile => profile.id === savedId) || rows[0]
    setActiveProfileId(selected?.id ?? null)
  }

  async function loadSupportedVersions () {
    setSupportedVersions(await api<string[]>('/api/versions'))
  }

  async function checkDatabase () {
    setDatabase('loading')
    try {
      const status = await api<{ database: string; engine: string }>('/api/health')
      setDatabase('connected')
      setDatabaseEngine(status.engine)
      await Promise.all([loadProfiles(), loadSupportedVersions()])
    } catch {
      setDatabase('failed')
    }
  }

  async function refreshBot () {
    try {
      const nextBot = await api<BotState>('/api/bot/state')
      setBot(nextBot)
      if (nextBot.activeJob) {
        setJobs(current => current.map(job => job.id === nextBot.activeJob?.id
          ? { ...job, status: nextBot.activeJob.status, completedColumns: nextBot.activeJob.completedColumns, error: nextBot.activeJob.error }
          : job))
      }
    } catch {
      setBot(emptyBot)
    }
  }

  async function toggleViewer () {
    const enabled = !bot.viewerEnabled
    try {
      const status = await api<{ enabled: boolean; running: boolean; port: number }>('/api/viewer', {
        method: 'POST',
        body: JSON.stringify({ enabled })
      })
      setBot(current => ({ ...current, viewerEnabled: status.enabled, viewerRunning: status.running, viewerPort: status.port }))
      notify(enabled ? '3D preview enabled.' : '3D preview disabled.')
    } catch (error) {
      notify(error instanceof Error ? error.message : '3D preview setting could not be changed.', 'error')
      await refreshBot()
    }
  }

  async function loadJobs () {
    if (!activeProfileId) return
    setJobsError('')
    try {
      setJobs(await api<FlatSurfaceJob[]>(`/api/jobs?profileId=${activeProfileId}`))
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : 'Jobs could not be loaded.')
    }
  }

  useEffect(() => {
    void checkDatabase()
    const healthTimer = window.setInterval(() => {
      void api<{ database: string; engine: string }>('/api/health')
        .then(async status => {
          setDatabase('connected')
          setDatabaseEngine(status.engine)
          await loadProfiles()
        })
        .catch(() => setDatabase('failed'))
    }, 5000)
    const clockTimer = window.setInterval(() => setNow(new Date()), 1000)
    return () => {
      window.clearInterval(healthTimer)
      window.clearInterval(clockTimer)
    }
  }, [])

  useEffect(() => {
    if (database !== 'connected') return
    void refreshBot()
    const timer = window.setInterval(() => void refreshBot(), 1000)
    return () => window.clearInterval(timer)
  }, [database])

  useEffect(() => {
    setDraft(activeProfile
      ? { host: activeProfile.host, port: activeProfile.port, username: activeProfile.username, authMode: activeProfile.authMode, minecraftVersion: activeProfile.minecraftVersion, botSettings: { ...activeProfile.botSettings } }
      : { host: '', port: null, username: '', authMode: 'microsoft', minecraftVersion: '1.21.5', botSettings: { ...defaultBotSettings } })
  }, [activeProfile?.id])

  useEffect(() => {
    if (view === 'flat-surface' && database === 'connected') void loadJobs()
  }, [view, database, activeProfileId])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [bot.chat.length])

  useEffect(() => {
    if (view !== 'information' || Object.keys(iconRecords).length) return
    fetch('https://webisso.github.io/minecraft-item-icons/api.json')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!data) return
        const records = collectIconRecords(data)
        const next: Record<string, IconRecord> = {}
        for (const record of records) next[normalizeItemName(record.file_slug.replace(/\.png$/i, ''))] = record
        setIconRecords(next)
      })
      .catch(() => {})
  }, [view, iconRecords])

  function iconFor (item: Item | null) {
    if (!item) return undefined
    const record = iconRecords[normalizeItemName(item.name)]
    if (!record) return undefined
    const segments = [record.category_slug, record.subcategory_slug, record.file_slug].filter((segment): segment is string => Boolean(segment))
    return `https://webisso.github.io/minecraft-item-icons/assets/${segments.map(encodeURIComponent).join('/')}`
  }

  function selectProfile (id: number) {
    setActiveProfileId(id)
    window.localStorage.setItem('active-profile-id', String(id))
    setView('settings')
  }

  function setJobField (key: keyof FlatSurfaceDraft, value: string) {
    setJobDraft(current => ({ ...current, [key]: value }))
  }

  async function createFlatSurfaceJob (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeProfile) return
    setJobsBusy(true)
    setJobsError('')
    try {
      const created = await api<FlatSurfaceJob>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ ...jobDraft, profileId: activeProfile.id })
      })
      setJobs(current => [created, ...current])
      setJobDraft({ ...emptyFlatSurfaceDraft })
      notify('Flat Surface job saved.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Job could not be saved.'
      setJobsError(message)
      notify(message, 'error')
    } finally {
      setJobsBusy(false)
    }
  }

  function requestStartJob (job: FlatSurfaceJob) {
    setConfirmation({
      action: 'start-job',
      jobId: job.id,
      title: `Start ${job.name}?`,
      description: `This will dig ${job.x2 - job.x1 + 1} by ${job.z2 - job.z1 + 1} columns from Y ${job.y1} through ${job.y2}. The bot may break path obstructions and place bridge blocks. Make sure the output chest is reachable and the bot carries bridge blocks.`,
      confirmLabel: 'Start job'
    })
  }

  async function startJob (jobId: number) {
    setJobsBusy(true)
    try {
      await api(`/api/jobs/${jobId}/start`, { method: 'POST' })
      setJobs(current => current.map(job => job.id === jobId ? { ...job, status: 'running', completedColumns: 0, error: null } : job))
      await refreshBot()
      notify('Flat Surface job started.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Job could not be started.', 'error')
      await loadJobs()
    } finally {
      setJobsBusy(false)
    }
  }

  async function stopJob (jobId: number) {
    setJobsBusy(true)
    try {
      await api(`/api/jobs/${jobId}/stop`, { method: 'POST' })
      setJobs(current => current.map(job => job.id === jobId ? { ...job, status: 'stopping' } : job))
      notify('Stop requested.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Job could not be stopped.', 'error')
    } finally {
      setJobsBusy(false)
    }
  }

  async function deleteJob (jobId: number) {
    try {
      await api(`/api/jobs/${jobId}`, { method: 'DELETE' })
      setJobs(current => current.filter(job => job.id !== jobId))
      notify('Job deleted.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Job could not be deleted.', 'error')
    }
  }

  async function createProfile (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = profileName.trim()
    if (!name) return
    setBusy(true)
    try {
      const profile = await api<Profile>('/api/profiles', { method: 'POST', body: JSON.stringify({ name }) })
      setProfiles(current => [...current, profile])
      setActiveProfileId(profile.id)
      window.localStorage.setItem('active-profile-id', String(profile.id))
      setProfileName('')
      setProfileDialogOpen(false)
      setView('settings')
      notify(`Profile "${profile.name}" created.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Profile could not be created.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile () {
    if (!activeProfile) return null
    setBusy(true)
    try {
      const updated = await api<Profile>(`/api/profiles/${activeProfile.id}`, {
        method: 'PUT',
        body: JSON.stringify(draft)
      })
      setProfiles(current => current.map(profile => profile.id === updated.id ? updated : profile))
      notify('Profile saved.')
      return updated
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Profile could not be saved.', 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function deleteProfile () {
    if (!activeProfile) return
    setBusy(true)
    try {
      await api(`/api/profiles/${activeProfile.id}`, { method: 'DELETE' })
      const remaining = profiles.filter(profile => profile.id !== activeProfile.id)
      setProfiles(remaining)
      setActiveProfileId(remaining[0]?.id ?? null)
      if (remaining[0]) window.localStorage.setItem('active-profile-id', String(remaining[0].id))
      else window.localStorage.removeItem('active-profile-id')
      notify('Profile deleted.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Profile could not be deleted.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function clearTemporaryData () {
    try {
      await api('/api/cache/clear', { method: 'POST' })
      await refreshBot()
      notify('Temporary data cleared.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Temporary data could not be cleared.', 'error')
    }
  }

  async function confirmDestructiveAction () {
    if (!confirmation) return
    const pending = confirmation
    setConfirmation(null)
    if (pending.action === 'delete-profile') await deleteProfile()
    else if (pending.action === 'clear-temporary-data') await clearTemporaryData()
    else if (pending.action === 'start-job' && pending.jobId) await startJob(pending.jobId)
    else if (pending.action === 'delete-job' && pending.jobId) await deleteJob(pending.jobId)
  }

  async function clearChat () {
    try {
      await api('/api/bot/chat/clear', { method: 'POST' })
      await refreshBot()
      notify('Live chat cleared.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Chat could not be cleared.', 'error')
    }
  }

  async function toggleConnection () {
    if (!activeProfile) return
    if (bot.connected || bot.connecting) {
      try {
        await api('/api/bot/disconnect', { method: 'POST' })
        await refreshBot()
        notify('Disconnect requested.')
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Disconnect failed.', 'error')
      }
      return
    }

    let profile = activeProfile
    if (isDirty) {
      const saved = await saveProfile()
      if (!saved) return
      profile = saved
    }
    try {
      await api('/api/bot/connect', { method: 'POST', body: JSON.stringify({ profileId: profile.id }) })
      await refreshBot()
      notify('Connecting to server...')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Connection could not start.', 'error')
    }
  }

  async function sendChat (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!chatMessage.trim() || !bot.connected) return
    try {
      await api('/api/bot/chat', { method: 'POST', body: JSON.stringify({ message: chatMessage }) })
      setChatMessage('')
      await refreshBot()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be sent.', 'error')
    }
  }

  async function inventoryAction (item: Item, action: string) {
    try {
      await api('/api/bot/inventory/action', {
        method: 'POST',
        body: JSON.stringify({ slot: item.slot, action })
      })
      setItemMenu(null)
      await refreshBot()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Inventory action failed.', 'error')
    }
  }

  function setDraftField<K extends keyof Draft> (key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function setBotSetting (key: keyof BotSettings, value: boolean) {
    setDraft(current => ({ ...current, botSettings: { ...current.botSettings, [key]: value } }))
  }

  if (database === 'loading') {
    return <div className="system-screen"><div className="system-mark"><BrandLogo compact /></div><div className="loader-line" /><p>Checking database connection</p></div>
  }

  if (database === 'failed') {
    return <main className="system-screen failure-screen">
      <div className="system-mark"><BrandLogo compact /></div>
      <div className="failure-copy">
        <span className="eyebrow">SYSTEM STATUS / STORAGE</span>
        <h1>Database connection failed</h1>
        <p>The dashboard cannot load profiles until the selected {databaseEngine} database is available.</p>
        <button className="button button-primary" onClick={() => void checkDatabase()}><Activity size={15} /> Retry connection</button>
      </div>
      <span className="system-footer">DATABASE: {databaseEngine} <i className="status-dot status-dot-error" /></span>
    </main>
  }

  if (!profiles.length) {
    return <main className="first-profile-screen">
      <div className="first-profile-top"><BrandLogo /><ClockDisplay now={now} /></div>
      <div className="first-profile-content">
        <span className="eyebrow">PROFILE MANAGER / 00</span>
        <h1>Start with a<br /><span>profile.</span></h1>
        <p>Keep each server and account configuration separate. Create a profile to open the control room.</p>
        <button className="button button-primary create-first" onClick={() => setProfileDialogOpen(true)}><Plus size={16} /> Create a profile now <ArrowUpRight size={15} /></button>
      </div>
      <div className="first-profile-bottom"><span><i className="status-dot" /> DATABASE CONNECTED / {databaseEngine}</span><span>VERSIONS 1.8.8 - 26.1</span></div>
      {profileDialogOpen && <ProfileDialog name={profileName} setName={setProfileName} onSubmit={createProfile} onClose={() => setProfileDialogOpen(false)} busy={busy} />}
      {toast && <Toast tone={toast.tone}>{toast.message}</Toast>}
    </main>
  }

  if (!activeProfile) {
    return <div className="system-screen"><div className="system-mark"><BrandLogo compact /></div><p>Loading profile configuration</p></div>
  }

  return <div className="app-shell">
    <div className={`drawer-scrim ${drawerOpen ? 'is-open' : ''}`} onClick={() => setDrawerOpen(false)} />
    <aside className={`side-drawer ${drawerOpen ? 'is-open' : ''}`} aria-label="Main navigation">
      <div className="drawer-brand"><BrandLogo compact /><button className="icon-button drawer-close" title="Close navigation" onClick={() => setDrawerOpen(false)}><X size={17} /></button></div>
      <div className="drawer-section-label">WORKSPACE</div>
      <nav>{navigation.map(item => {
        const Icon = item.icon
        return <button key={item.id} className={`drawer-link ${view === item.id ? 'active' : ''}`} onClick={() => { setView(item.id); setDrawerOpen(false) }}>
          <Icon size={17} strokeWidth={1.7} /><span>{item.label}</span>{view === item.id && <span className="nav-active-mark" />}
        </button>
      })}</nav>
      <div className="drawer-section-label jobs-nav-heading">JOBS</div>
      <nav className="jobs-navigation">{jobNavigation.map(item => {
        const Icon = item.icon
        return <button key={item.id} className={`drawer-link ${view === item.id ? 'active' : ''}`} onClick={() => { setView(item.id); setDrawerOpen(false) }}>
          <Icon size={17} strokeWidth={1.7} /><span>{item.label}</span>{view === item.id && <span className="nav-active-mark" />}
        </button>
      })}</nav>
      <div className="drawer-profile"><span className="drawer-section-label">ACTIVE PROFILE</span><strong>{activeProfile?.name}</strong><span>{activeProfile?.host || 'Server not configured'}</span><button onClick={() => { setView('settings'); setDrawerOpen(false) }}><Settings2 size={13} /> Profile settings</button></div>
      <div className="drawer-footer"><span><i className="status-dot" /> STORAGE ONLINE</span><span>BUILD 0.1.0 / MC {activeProfile.minecraftVersion}</span></div>
    </aside>

    <header className="topbar">
      <div className="topbar-left"><button className="icon-button menu-button" title="Open navigation" onClick={() => setDrawerOpen(true)}><Menu size={19} /></button><BrandLogo /><div className="topbar-divider" /><div className="topbar-context"><span className="eyebrow">CONTROL ROOM</span><span>{activeView.label}</span></div><div className="clock-display topbar-clock"><span className="clock-time">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span><span className="clock-date">{now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span></div></div>
      <div className="topbar-right">
        {bot.connected && <div className="live-metrics"><span><Heart size={13} /> {bot.health ?? '--'}/20</span><span><Zap size={13} /> {bot.food ?? '--'}/20</span><span><Wifi size={13} /> {bot.ping ?? '--'}ms</span></div>}
        <label className="profile-select-wrap"><span className="sr-only">Active profile</span><select value={activeProfileId ?? ''} disabled={bot.connected || bot.connecting} onChange={event => selectProfile(Number(event.target.value))} aria-label="Select profile">{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><ChevronDown size={13} /></label>
        <button className="icon-button top-action" title="Create new profile" onClick={() => setProfileDialogOpen(true)} disabled={bot.connected || bot.connecting}><Plus size={17} /></button>
        <button className="icon-button top-action save-action" title="Save profile" onClick={() => void saveProfile()} disabled={!isDirty || busy}><Save size={16} /></button>
        <button className={`icon-button top-action viewer-toggle ${bot.viewerEnabled ? 'is-active' : ''}`} title={bot.viewerEnabled ? 'Disable 3D live preview' : 'Enable 3D live preview'} aria-label={bot.viewerEnabled ? 'Disable 3D live preview' : 'Enable 3D live preview'} aria-pressed={bot.viewerEnabled} onClick={() => void toggleViewer()} disabled={!bot.connected && !bot.viewerEnabled}><Eye size={16} /></button>
        <button className={`connect-button ${bot.connected ? 'is-connected' : ''} ${bot.connecting ? 'is-connecting' : ''}`} onClick={() => void toggleConnection()} disabled={!activeProfile || busy}>
          <i className={`status-dot ${bot.connected ? 'status-dot-live' : bot.connecting ? 'status-dot-wait' : ''}`} />
          <span>{bot.connected ? 'Disconnect' : bot.connecting ? 'Connecting' : 'Connect'}</span>
        </button>
      </div>
    </header>

    {bot.authCode && <div className="auth-banner"><span><Shield size={16} /> Microsoft sign-in required</span><strong>{bot.authCode.userCode}</strong><a href={bot.authCode.verificationUri} target="_blank" rel="noreferrer">Open sign-in <ArrowUpRight size={13} /></a></div>}

    <main className="main-content">
      <div className="page-heading"><div><span className="eyebrow">{activeProfile.name.toUpperCase()} / {view === 'settings' ? 'CONFIGURATION' : view === 'bot-settings' ? 'BOT BEHAVIOR' : view === 'flat-surface' ? 'JOBS' : view === 'viewer' ? 'WORLD PREVIEW' : view === 'chat' ? 'COMMUNICATION' : 'TELEMETRY'}</span><h1>{activeView.label}</h1></div><div className="heading-meta"><span className={`connection-copy ${bot.connected ? 'is-live' : ''}`}><i className={`status-dot ${bot.connected ? 'status-dot-live' : bot.connecting ? 'status-dot-wait' : ''}`} />{bot.connected ? 'CONNECTED' : bot.connecting ? 'CONNECTING' : 'DISCONNECTED'}</span><span className="meta-separator" /> <span>PROFILE {String(activeProfile.id).padStart(2, '0')}</span></div></div>

      {view === 'settings' && <section className="settings-layout">
        <div className="settings-main">
          <section className="panel-section server-section">
            <SectionHeader index="01" title="Server connection" subtitle="Connection details are saved to this profile." />
            <div className="field-grid">
              <Field label="Server IP" className="span-two"><input autoComplete="off" placeholder="play.example.net" value={draft.host} onChange={event => setDraftField('host', event.target.value)} /></Field>
              <Field label="Port" hint="Optional"><input type="number" min="1" max="65535" placeholder="25565" value={draft.port ?? ''} onChange={event => setDraftField('port', event.target.value ? Number(event.target.value) : null)} /></Field>
              <Field label="Join username"><input autoComplete="off" placeholder="Minecraft username or Microsoft account" value={draft.username} onChange={event => setDraftField('username', event.target.value)} /></Field>
              <Field label="Authentication"><select value={draft.authMode} onChange={event => setDraftField('authMode', event.target.value as Draft['authMode'])}><option value="microsoft">Microsoft account</option><option value="offline">Offline mode</option></select></Field>
              <Field label="Minecraft version" hint={`${supportedVersions.length} tested versions`}><select value={draft.minecraftVersion} onChange={event => setDraftField('minecraftVersion', event.target.value)}>{(supportedVersions.length ? supportedVersions : ['1.21.5']).map(version => <option key={version} value={version}>{version}</option>)}</select></Field>
            </div>
            <div className="inline-note"><CircleHelp size={14} /><span>Microsoft sign-in opens a device authorization prompt after connecting. Offline mode only works on servers without account authentication.</span></div>
          </section>

          <section className="panel-section">
            <SectionHeader index="02" title="Storage" subtitle="Profile and connection settings persist in your selected database." />
            <div className="database-row"><div className="db-icon"><Database size={17} /></div><div className="db-copy"><strong>{databaseEngine === 'PSQL' ? 'PostgreSQL' : 'MySQL'} database</strong><span>Configuration storage</span></div><span className="database-status"><i className="status-dot" /> Connected</span></div>
          </section>

          <section className="panel-section danger-section">
            <SectionHeader index="03" title="Profile & temporary data" subtitle="These actions do not delete database credentials." />
            <div className="action-row"><div><strong>Clear caches and temporary data</strong><span>Removes the current live chat and temporary system log history.</span></div><button className="button button-secondary" onClick={() => setConfirmation({ action: 'clear-temporary-data', title: 'Clear temporary data?', description: 'This clears the current live chat and temporary system log history. Your profile and database settings are not affected.', confirmLabel: 'Clear data' })}><Archive size={14} /> Clear temporary data</button></div>
            <div className="action-row delete-row"><div><strong>Delete profile</strong><span>Remove this profile and its saved server configuration.</span></div><button className="button button-danger" onClick={() => setConfirmation({ action: 'delete-profile', title: `Delete ${activeProfile.name}?`, description: 'This permanently removes the profile and its saved server configuration.', confirmLabel: 'Delete profile' })} disabled={bot.profileId === activeProfile.id}><Trash2 size={14} /> Delete profile</button></div>
          </section>
        </div>
        <aside className="settings-aside"><div className="aside-kicker"><span>PROFILE</span><span>{String(activeProfile.id).padStart(2, '0')}</span></div><div className="profile-monogram">{activeProfile.name.slice(0, 1).toUpperCase()}</div><h2>{activeProfile.name}</h2><p>{draft.host || 'No server configured'}</p><div className="aside-rule" /><div className="aside-stat"><span>GAME VERSION</span><strong>{draft.minecraftVersion}</strong></div><div className="aside-stat"><span>DATABASE</span><strong>{databaseEngine}</strong></div><div className="aside-stat"><span>AUTH MODE</span><strong>{draft.authMode === 'microsoft' ? 'MICROSOFT' : 'OFFLINE'}</strong></div><div className="aside-footer"><Command size={13} /> PROFILE DATA SAVES INDEPENDENTLY</div></aside>
      </section>}

      {view === 'bot-settings' && <section className="bot-settings-layout">
        <div className="bot-settings-intro"><div className="section-header"><span className="section-index">AUTO</span><div><h2>Behavior controls</h2><p>These actions run only while this profile is connected. All are disabled by default.</p></div></div><span className="settings-save-state">{isDirty ? 'UNSAVED CHANGES' : 'SAVED TO PROFILE'}</span></div>
        <div className="bot-settings-list">{botSettingRows.map(setting => {
          const Icon = setting.icon
          const checked = draft.botSettings[setting.key]
          return <article className={`bot-setting-row ${checked ? 'is-enabled' : ''}`} key={setting.key}>
            <div className="bot-setting-icon"><Icon size={17} strokeWidth={1.7} /></div>
            <div className="bot-setting-copy"><h3>{setting.title}</h3><p>{setting.detail}</p></div>
            <button type="button" className={`toggle-switch ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} aria-label={setting.title} onClick={() => setBotSetting(setting.key, !checked)}><span /></button>
          </article>
        })}</div>
        <div className="bot-settings-footer"><span><CircleHelp size={14} /> Changes are stored with this profile. Use Save Profile in the top bar to apply them.</span><span>{Object.values(draft.botSettings).filter(Boolean).length} / {botSettingRows.length} ENABLED</span></div>
      </section>}

      {view === 'flat-surface' && <section className="flat-jobs-layout">
        <div className="flat-job-intro"><div><span className="eyebrow">JOB TYPE / TERRAIN</span><h2>Flatten a surface</h2><p>Dig a bounded volume in a continuous Z-snake. The bot keeps the floor at Y1 - 1 and clears each column from top to bottom. Maximum area: 65,536 columns.</p></div><span className="job-depth-chip">MAX DEPTH <strong>4 BLOCKS</strong></span></div>

        <form className="flat-job-form" onSubmit={event => void createFlatSurfaceJob(event)}>
          <div className="flat-job-form-heading"><SectionHeader index="01" title="Job area" subtitle="X1 and Z1 must be the lower horizontal corner; Y1 is the lower vertical level." /><span className="job-version-label">FLAT SURFACE</span></div>
          <Field label="Job name"><input maxLength={80} placeholder="North clearing" value={jobDraft.name} onChange={event => setJobField('name', event.target.value)} /></Field>

          <div className="job-coordinate-pair">
            <CoordinateGroup title="Start corner" corner="X1 / Y1 / Z1" values={jobDraft} keys={['x1', 'y1', 'z1']} onChange={setJobField} />
            <CoordinateGroup title="End corner" corner="X2 / Y2 / Z2" values={jobDraft} keys={['x2', 'y2', 'z2']} onChange={setJobField} />
          </div>

          <div className="job-height-note"><span>INCLUSIVE DIGGING HEIGHT</span><strong>{jobDraft.y1 !== '' && jobDraft.y2 !== '' && Number(jobDraft.y2) >= Number(jobDraft.y1) ? `${Number(jobDraft.y2) - Number(jobDraft.y1) + 1} / 4 blocks` : '-- / 4 blocks'}</strong><small>For example, Y1 = 1 and Y2 = 4 clears four layers.</small></div>

          <div className="job-form-divider" />
          <SectionHeader index="02" title="Output chest" subtitle="Place a chest outside the dig volume and make sure it is reachable." />
          <CoordinateGroup title="Chest block coordinates" corner="X / Y / Z" values={jobDraft} keys={['chestX', 'chestY', 'chestZ']} onChange={setJobField} />

          <div className="job-safety-note"><Shield size={15} /><span>Bring at least 16 dirt, stone, or cobblestone blocks for safe bridging. The route starts at X1 - 1, Y1, Z1 and checks the floor at Y1 - 1 before each step. Water and lava inside the digging volume are left untouched.</span></div>
          {!bot.connected && <div className="job-disconnected-note"><Wifi size={14} /> Connect the bot to start a saved job.</div>}
          {jobsError && <div className="job-form-error"><CircleAlert size={14} />{jobsError}</div>}
          <div className="job-form-actions"><span>Jobs are saved to profile <strong>{activeProfile.name}</strong>.</span><button type="submit" className="button button-primary" disabled={jobsBusy}><Plus size={15} /> Save job</button></div>
        </form>

        <section className="saved-jobs-section">
          <div className="saved-jobs-heading"><SectionHeader index="03" title="Saved jobs" subtitle="One job runs at a time. Start requires a connected bot." /><span>{String(jobs.length).padStart(2, '0')} JOBS</span></div>
          {jobsError && !jobs.length && <div className="jobs-empty"><CircleAlert size={17} /><strong>Jobs could not be loaded</strong><span>{jobsError}</span></div>}
          {!jobs.length && !jobsError && <div className="jobs-empty"><Activity size={17} /><strong>No saved jobs</strong><span>Define an area and output chest above, then save it here.</span></div>}
          <div className="saved-jobs-list">{jobs.map(job => {
            const isRunning = job.status === 'running' || job.status === 'stopping'
            const progress = job.totalColumns ? Math.min(100, job.completedColumns / job.totalColumns * 100) : 0
            return <article className="saved-job-card" key={job.id}>
              <div className="saved-job-main"><div className="saved-job-mark"><Activity size={16} /></div><div className="saved-job-details"><div className="saved-job-title"><h3>{job.name}</h3><span className={`job-status status-${job.status}`}>{job.status}</span></div><p>X {job.x1} to {job.x2} / Y {job.y1} to {job.y2} / Z {job.z1} to {job.z2}</p><small>CHEST {job.chestX}, {job.chestY}, {job.chestZ} | {job.totalColumns.toLocaleString()} COLUMNS</small>{(isRunning || job.completedColumns > 0) && <div className="job-progress"><span style={{ width: `${progress}%` }} /></div>}{job.error && <span className="saved-job-error">{job.error}</span>}</div></div>
              <div className="saved-job-actions">
                {isRunning ? <button className="icon-button job-stop-button" title="Stop job" onClick={() => void stopJob(job.id)} disabled={jobsBusy}><Square size={15} /></button> : <button className="icon-button job-start-button" title="Start job" onClick={() => requestStartJob(job)} disabled={!bot.connected || jobsBusy}><Play size={15} /></button>}
                <button className="icon-button job-delete-button" title="Delete saved job" onClick={() => setConfirmation({ action: 'delete-job', jobId: job.id, title: `Delete ${job.name}?`, description: 'This removes the saved job and its progress record.', confirmLabel: 'Delete job' })} disabled={isRunning || jobsBusy}><Trash2 size={15} /></button>
              </div>
            </article>
          })}</div>
        </section>
      </section>}

      {view === 'chat' && <section className="console-grid">
        <ConsolePanel title="Live server chat" icon={<MessageSquareText size={16} />} count={bot.chat.length} className="chat-panel" action={<button className="icon-button console-clear" title="Clear chat" disabled={!bot.chat.length} onClick={() => void clearChat()}><Trash2 size={14} /></button>}>
          <div className={`console-body chat-body ${!bot.connected ? 'is-locked' : ''}`}>
            {!bot.connected && <div className="console-empty"><span className="lock-mark"><MessageSquareText size={18} /></span><strong>Connect the bot to start chat</strong><span>Server messages and player chat will appear here.</span></div>}
            {bot.connected && bot.chat.length === 0 && <div className="console-empty"><span className="lock-mark"><MessageSquareText size={18} /></span><strong>Waiting for server messages</strong><span>Live chat will appear here when received.</span></div>}
            {bot.chat.map((entry, index) => <div className={`chat-line ${entry.position === 'outgoing' ? 'outgoing' : ''}`} key={`${entry.time}-${index}`}><time>{formatTime(entry.time)}</time><span className="chat-position">{entry.position === 'outgoing' ? 'YOU' : entry.position.toUpperCase()}</span><p>{entry.message}</p></div>)}
            <div ref={chatEnd} />
          </div>
          <form className={`chat-composer ${!bot.connected ? 'is-disabled' : ''}`} onSubmit={event => void sendChat(event)}>
            <input value={chatMessage} onChange={event => setChatMessage(event.target.value)} placeholder={bot.connected ? 'Message or /command...' : 'Connect the bot to send messages'} disabled={!bot.connected} maxLength={256} />
            <button type="submit" className="icon-button send-button" title="Send message" disabled={!bot.connected || !chatMessage.trim()}><Send size={16} /></button>
          </form>
        </ConsolePanel>
        <ConsolePanel title="System logs" icon={<FileText size={16} />} count={bot.logs.length} className="logs-panel">
          <div className="console-body log-body">
            {!bot.logs.length && <div className="console-empty"><span className="lock-mark"><Activity size={18} /></span><strong>System log is clear</strong><span>Connection events and runtime errors will be recorded here.</span></div>}
            {bot.logs.map((entry, index) => <div className={`log-line log-${entry.level}`} key={`${entry.time}-${index}`}><time>{formatTime(entry.time)}</time><span>{entry.level.toUpperCase()}</span><p>{entry.message}</p></div>)}
          </div>
          <div className="console-footer"><span><i className="status-dot" /> LIVE BUFFER</span><span>LAST 150 EVENTS</span></div>
        </ConsolePanel>
      </section>}

      {view === 'information' && <section className="information-layout">
        <div className="telemetry-strip">
          <Telemetry label="Health" value={bot.connected ? `${bot.health ?? '--'} / 20` : '--'} icon={<Heart size={15} />} meter={bot.connected ? bot.health : null} />
          <Telemetry label="Hunger" value={bot.connected ? `${bot.food ?? '--'} / 20` : '--'} icon={<Zap size={15} />} meter={bot.connected ? bot.food : null} />
          <Telemetry label="Experience" value={bot.connected ? `LV ${bot.level ?? '--'}` : '--'} icon={<Activity size={15} />} />
          <Telemetry label="Server ping" value={bot.connected ? `${bot.ping ?? '--'} ms` : '--'} icon={<Wifi size={15} />} />
          <Telemetry label="Dimension" value={bot.connected ? bot.dimension || '--' : '--'} icon={<ArrowUpRight size={15} />} />
        </div>
        <div className="position-bar"><span className="eyebrow">CURRENT POSITION</span><div className="coordinates">{bot.connected && bot.position ? <><span>X <b>{bot.position.x}</b></span><span>Y <b>{bot.position.y}</b></span><span>Z <b>{bot.position.z}</b></span></> : <span className="muted-value">Connect the bot to receive live coordinates</span>}</div><span className="position-world">{bot.connected ? bot.dimension || 'WORLD' : 'OFFLINE'}</span></div>

        <div className="equipment-layout">
          <section className="equipment-panel">
            <SectionHeader index="01" title="Equipment" subtitle="Hover for item details. Select an occupied slot for actions." />
            <div className="equipment-slots">
              {(bot.armor.length ? bot.armor : [
                { slot: 5, label: 'Head', item: null }, { slot: 6, label: 'Chest', item: null }, { slot: 7, label: 'Legs', item: null }, { slot: 8, label: 'Feet', item: null }
              ]).map(slot => <ItemSlot key={slot.slot} item={slot.item} label={slot.label} iconUrl={iconFor(slot.item)} open={itemMenu === slot.slot} disabled={!bot.connected} onToggle={() => setItemMenu(itemMenu === slot.slot ? null : slot.slot)} onAction={action => slot.item && void inventoryAction(slot.item, action)} armorSlot={slot.label.toLowerCase()} />)}
              <ItemSlot item={bot.offhand} label="Off hand" iconUrl={iconFor(bot.offhand)} open={itemMenu === 45} disabled={!bot.connected} onToggle={() => setItemMenu(itemMenu === 45 ? null : 45)} onAction={action => bot.offhand && void inventoryAction(bot.offhand, action)} />
              <ItemSlot item={bot.mainHand} label="Main hand" iconUrl={iconFor(bot.mainHand)} open={itemMenu === -1} disabled={!bot.connected} onToggle={() => setItemMenu(itemMenu === -1 ? null : -1)} onAction={action => bot.mainHand && void inventoryAction(bot.mainHand, action)} />
            </div>
          </section>
          <section className="inventory-panel">
            <div className="inventory-heading"><SectionHeader index="02" title="Inventory" subtitle="36 player slots" /><span className="inventory-count">{bot.connected ? `${bot.inventory.filter(Boolean).length} / 36` : '-- / 36'}</span></div>
            <div className="inventory-grid">{Array.from({ length: 36 }, (_, index) => {
              const item = bot.inventory[index] || null
              const slot = item?.slot ?? index + 9
              return <ItemSlot key={slot} item={item} label={`Slot ${index + 1}`} iconUrl={iconFor(item)} open={itemMenu === slot} disabled={!bot.connected || !item} onToggle={() => setItemMenu(itemMenu === slot ? null : slot)} onAction={action => item && void inventoryAction(item, action)} />
            })}</div>
            {!bot.connected && <div className="inventory-overlay"><Package size={17} /><span>Inventory appears when the bot is connected</span></div>}
          </section>
        </div>
        <div className="information-foot"><span><CircleHelp size={13} /> Item data and equipment update from the live player inventory.</span><a href="https://github.com/Webisso/minecraft-item-icons" target="_blank" rel="noreferrer">ITEM ICON SOURCE <ArrowUpRight size={12} /></a></div>
      </section>}

      {view === 'viewer' && <section className="viewer-page">
        <div className="viewer-page-heading"><div><h2>3D world preview</h2><p>Live first-person world data from the connected bot.</p></div><div className="viewer-state"><i className={`status-dot ${bot.viewerRunning ? 'status-dot-live' : ''}`} />{bot.viewerRunning ? `LIVE / ${bot.viewerPort}` : 'OFFLINE'}</div></div>
        {!bot.connected && <div className="viewer-placeholder"><Eye size={23} /><strong>Connect the bot to view the world</strong><span>The live preview becomes available after the bot spawns.</span></div>}
        {bot.connected && !bot.viewerEnabled && <div className="viewer-placeholder"><Eye size={23} /><strong>Live preview is disabled</strong><span>Enable it with the eye toggle in the top bar.</span><button className="button button-primary" onClick={() => void toggleViewer()}><Eye size={15} /> Enable preview</button></div>}
        {bot.connected && bot.viewerEnabled && !bot.viewerRunning && <div className="viewer-placeholder"><div className="loader-line" /><strong>Starting the 3D preview</strong><span>The viewer will appear here when its local server is ready.</span></div>}
        {bot.connected && bot.viewerRunning && <iframe className="viewer-frame" src="/viewer/" title="ObsidianMC live Minecraft world preview" allow="fullscreen" />}
      </section>}
    </main>

    <footer className="app-footer"><span><i className="status-dot" /> DATABASE / {databaseEngine}</span><span>PROFILE CHANGES {isDirty ? 'UNSAVED' : 'SAVED'}</span><span>MINEFLAYER 4.39.0</span></footer>
    {profileDialogOpen && <ProfileDialog name={profileName} setName={setProfileName} onSubmit={createProfile} onClose={() => setProfileDialogOpen(false)} busy={busy} />}
    {confirmation && <ConfirmationDialog confirmation={confirmation} busy={busy} onCancel={() => { if (!busy) setConfirmation(null) }} onConfirm={() => void confirmDestructiveAction()} />}
    {toast && <Toast tone={toast.tone}>{toast.message}</Toast>}
  </div>
}

function BrandLogo ({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`} role="img" aria-label="ObsidianMC Bot">
    <span className="brand-glyph"><Gem size={17} strokeWidth={1.7} /><span className="brand-bot-mark"><Bot size={10} strokeWidth={1.8} /></span></span>
    <span className="brand-wordmark"><strong>OBSIDIANMC</strong><small>All In One Minecraft Automation Engine</small></span>
  </div>
}

function ClockDisplay ({ now }: { now: Date }) {
  return <div className="clock-display"><span className="clock-time">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span><span className="clock-date">{now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
}

function SectionHeader ({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="section-header"><span className="section-index">{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
}

function CoordinateGroup ({ title, corner, values, keys, onChange }: {
  title: string
  corner: string
  values: FlatSurfaceDraft
  keys: (keyof FlatSurfaceDraft)[]
  onChange: (key: keyof FlatSurfaceDraft, value: string) => void
}) {
  return <div className="coordinate-group">
    <div className="coordinate-group-heading"><strong>{title}</strong><span>{corner}</span></div>
    <div className="coordinate-input-grid">{keys.map(key => <Field key={key} label={key.toUpperCase()}><input type="number" step="1" placeholder="0" value={values[key]} onChange={event => onChange(key, event.target.value)} required /></Field>)}</div>
  </div>
}

function Field ({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return <label className={`field ${className}`}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>
}

function ConsolePanel ({ title, icon, count, className = '', action, children }: { title: string; icon: ReactNode; count: number; className?: string; action?: ReactNode; children: ReactNode }) {
  return <section className={`console-panel ${className}`}><header className="console-heading"><div>{icon}<h2>{title}</h2></div><div className="console-heading-actions">{action}<span>{String(count).padStart(2, '0')}</span></div></header>{children}</section>
}

function Telemetry ({ label, value, icon, meter }: { label: string; value: string; icon: ReactNode; meter?: number | null }) {
  return <div className="telemetry-cell"><div className="telemetry-label">{icon}<span>{label}</span></div><strong>{value}</strong>{meter !== undefined && <div className="meter-track"><span style={{ width: `${Math.max(0, Math.min(100, (meter ?? 0) * 5))}%` }} /></div>}</div>
}

function ItemSlot ({ item, label, iconUrl, open, disabled, onToggle, onAction, armorSlot }: {
  item: Item | null
  label: string
  iconUrl?: string
  open: boolean
  disabled: boolean
  onToggle: () => void
  onAction: (action: string) => void
  armorSlot?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const details = item
    ? `${item.displayName} x${item.count}${item.enchantments.length ? `\n${item.enchantments.map(enchantment => `${enchantment.name} ${enchantment.level}`).join('\n')}` : ''}${item.maxDurability ? `\nDurability ${item.maxDurability - item.durabilityUsed}/${item.maxDurability}` : ''}`
    : `${label} - empty`
  const equipSlot = armorSlot || (item?.name.match(/helmet|cap/) ? 'head' : item?.name.match(/chestplate|elytra/) ? 'torso' : item?.name.match(/leggings/) ? 'legs' : item?.name.match(/boots/) ? 'feet' : null)

  return <div className={`item-slot-wrap ${open ? 'menu-open' : ''}`}>
    <button type="button" className={`item-slot ${item ? 'has-item' : ''}`} title={details} aria-label={details.replaceAll('\n', ', ')} disabled={disabled} onClick={onToggle}>
      {item && iconUrl && !imageFailed ? <img src={iconUrl} alt="" onError={() => setImageFailed(true)} /> : item ? <Box size={19} strokeWidth={1.2} /> : <span className="slot-plus">+</span>}
      {item && item.count > 1 && <small>{item.count}</small>}
    </button>
    <span className="slot-label">{label}</span>
    {open && item && <div className="item-action-menu" role="menu">
      <div className="item-menu-title">{item.displayName}<span>{item.count}x</span></div>
      {equipSlot && <button onClick={() => onAction(equipSlot)}><Shield size={13} /> Wear {equipSlot}</button>}
      <button onClick={() => onAction('main-hand')}><ArrowUpRight size={13} /> Take to main hand</button>
      <button onClick={() => onAction('off-hand')}><ArrowDownToLine size={13} /> Take to off hand</button>
      <button className="item-drop-action" onClick={() => onAction('drop')}><Trash2 size={13} /> Drop stack</button>
    </div>}
  </div>
}

function ProfileDialog ({ name, setName, onSubmit, onClose, busy }: { name: string; setName: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; busy: boolean }) {
  return <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form className="profile-modal" onSubmit={onSubmit}>
      <button type="button" className="icon-button modal-close" title="Close dialog" onClick={onClose}><X size={17} /></button>
      <span className="eyebrow">PROFILE MANAGER / NEW</span>
      <h2>Create a profile</h2>
      <p>Each profile keeps its server and account configuration separate.</p>
      <Field label="Profile name"><input autoFocus maxLength={60} placeholder="e.g. Survival server" value={name} onChange={event => setName(event.target.value)} required /></Field>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !name.trim()}><Plus size={15} /> Create profile</button></div>
    </form>
  </div>
}

function ConfirmationDialog ({ confirmation, busy, onCancel, onConfirm }: { confirmation: Confirmation; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ActionIcon = confirmation.action === 'start-job' ? Play : Trash2
  return <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }} onKeyDown={event => { if (event.key === 'Escape') onCancel() }}>
    <section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
      <div className="confirmation-icon"><CircleAlert size={19} /></div>
      <span className="eyebrow">CONFIRM ACTION</span>
      <h2 id="confirmation-title">{confirmation.title}</h2>
      <p id="confirmation-description">{confirmation.description}</p>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="button button-danger" onClick={onConfirm} disabled={busy} autoFocus><ActionIcon size={14} />{busy ? 'Working...' : confirmation.confirmLabel}</button></div>
    </section>
  </div>
}

function Toast ({ children, tone }: { children: ReactNode; tone: ToastMessage['tone'] }) {
  return <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>{tone === 'error' ? <CircleAlert size={15} /> : <Check size={15} />}{children}</div>
}

export default App