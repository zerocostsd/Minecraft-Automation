const path = require('node:path')
const net = require('node:net')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const pvpPlugin = require('mineflayer-pvp').plugin
const { runFlatSurface } = require('./jobs/flat-surface')

let bot = null
let activeProfileId = null
let viewerEnabled = false
let viewerBot = null
let viewerClose = null
let protectedTool = null
let lastGreetingAt = 0
let activeJobController = null
let defaultMovements = null
let botSettings = {
  emergencyLeave: false,
  autoEat: false,
  fightMobs: false,
  neverBreakTools: false,
  greetPlayers: false
}

const greetingCooldowns = new Map()
const hostileMobs = new Set([
  'blaze', 'bogged', 'cave_spider', 'drowned', 'husk', 'magma_cube',
  'phantom', 'pillager', 'silverfish', 'skeleton', 'slime', 'spider',
  'stray', 'vindicator', 'witch', 'zombie', 'zombie_villager'
])
const greetings = [
  username => `Hello, ${username}!`,
  username => `Hey ${username}, welcome!`,
  username => `Hi ${username}!`,
  username => `Good to see you, ${username}.`
]

const state = {
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
  botSettings: { ...botSettings },
  activeJob: null,
  viewerEnabled: false,
  viewerRunning: false,
  viewerPort: Number(process.env.VIEWER_PORT || 3001)
}

function addLog (level, message) {
  state.logs.push({ time: new Date().toISOString(), level, message: String(message).slice(0, 1500) })
  state.logs = state.logs.slice(-150)
}

function itemData (item, slot) {
  if (!item) return null

  const maxDurability = Number(item.maxDurability) || 0
  const durabilityUsed = Number(item.durabilityUsed) || 0

  return {
    slot,
    name: item.name,
    displayName: item.displayName || item.name,
    count: item.count,
    maxDurability,
    durabilityUsed,
    enchantments: Array.isArray(item.enchants)
      ? item.enchants.map(enchantment => ({ name: enchantment.name, level: enchantment.lvl }))
      : []
  }
}

function getDimension () {
  const dimension = String(bot?.game?.dimension || bot?.game?.levelType || '').toLowerCase()
  if (dimension.includes('nether')) return 'Nether'
  if (dimension.includes('end')) return 'The End'
  return dimension ? 'Overworld' : null
}

function refreshSnapshot () {
  if (!bot || !state.connected) return

  state.health = Number.isFinite(bot.health) ? bot.health : null
  state.food = Number.isFinite(bot.food) ? bot.food : null
  state.level = Number.isFinite(bot.experience?.level) ? bot.experience.level : null
  state.ping = Number.isFinite(bot.player?.ping) ? bot.player.ping : null
  state.position = bot.entity?.position
    ? {
        x: Math.round(bot.entity.position.x * 10) / 10,
        y: Math.round(bot.entity.position.y * 10) / 10,
        z: Math.round(bot.entity.position.z * 10) / 10
      }
    : null
  state.dimension = getDimension()

  const slots = bot.inventory?.slots || []
  state.inventory = slots.slice(9, 45).map((item, index) => itemData(item, index + 9))
  state.armor = [
    { slot: 5, label: 'Head', item: itemData(slots[5], 5) },
    { slot: 6, label: 'Chest', item: itemData(slots[6], 6) },
    { slot: 7, label: 'Legs', item: itemData(slots[7], 7) },
    { slot: 8, label: 'Feet', item: itemData(slots[8], 8) }
  ]
  state.offhand = itemData(slots[45], 45)
  state.mainHand = itemData(bot.heldItem, bot.quickBarSlot + 36)
}

function getState () {
  refreshSnapshot()
  return { ...state, inventory: [...state.inventory], armor: [...state.armor], chat: [...state.chat], logs: [...state.logs], botSettings: { ...state.botSettings }, activeJob: state.activeJob ? { ...state.activeJob } : null }
}

function getViewerStatus () {
  return { enabled: viewerEnabled, running: state.viewerRunning, port: state.viewerPort }
}

function stopViewer () {
  if (viewerClose) {
    try {
      viewerClose()
    } catch (error) {
      addLog('warn', `3D preview could not close cleanly: ${error.message}`)
    }
  }
  viewerBot = null
  viewerClose = null
  state.viewerRunning = false
}

function checkViewerPort (port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, () => probe.close(() => resolve(true)))
  })
}

async function startViewer (activeBot) {
  if (!viewerEnabled || !activeBot || !state.connected) return getViewerStatus()
  if (viewerBot === activeBot && state.viewerRunning) return getViewerStatus()

  const port = Number(process.env.VIEWER_PORT || 3001)
  if (!(await checkViewerPort(port))) throw new Error(`3D preview port ${port} is already in use.`)
  if (bot !== activeBot || !viewerEnabled) return getViewerStatus()

  const { mineflayer: createViewer } = require('prismarine-viewer')
  createViewer(activeBot, {
    port,
    prefix: '/viewer',
    viewDistance: Number(process.env.VIEWER_VIEW_DISTANCE || 2),
    firstPerson: true
  })

  if (!activeBot.viewer?.close) throw new Error('Prismarine Viewer did not expose a close handle.')
  viewerBot = activeBot
  viewerClose = activeBot.viewer.close.bind(activeBot.viewer)
  state.viewerPort = port
  state.viewerRunning = true
  addLog('info', `3D preview listening on port ${port} with view distance ${process.env.VIEWER_VIEW_DISTANCE || 2}.`)
  return getViewerStatus()
}

async function setViewerEnabled (enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Viewer enabled must be true or false.')
  if (enabled && (!bot || !state.connected)) throw new Error('Connect the bot before enabling the 3D preview.')

  viewerEnabled = enabled
  state.viewerEnabled = enabled
  if (!enabled) {
    stopViewer()
    addLog('info', '3D preview disabled.')
    return getViewerStatus()
  }

  try {
    return await startViewer(bot)
  } catch (error) {
    viewerEnabled = false
    state.viewerEnabled = false
    stopViewer()
    addLog('error', `3D preview could not start: ${error.message}`)
    throw error
  }
}

function stopActiveJob (reason = 'Bot disconnected.') {
  if (!activeJobController) return
  activeJobController.abort(reason)
  bot?.pathfinder?.setGoal(null)
  bot?.stopDigging?.()
  if (state.activeJob) state.activeJob = { ...state.activeJob, status: 'stopping' }
}

function startFlatSurface (job, onPersist = async () => {}) {
  if (!bot || !state.connected) throw new Error('Connect the bot before starting a job.')
  if (activeProfileId !== Number(job.profile_id)) throw new Error('The job must belong to the connected profile.')
  if (activeJobController) throw new Error('Another job is already running.')

  const controller = new AbortController()
  activeJobController = controller
  state.activeJob = {
    id: job.id,
    name: job.name,
    type: job.type,
    status: 'running',
    completedColumns: Number(job.completed_columns) || 0,
    totalColumns: Number(job.total_columns),
    minedBlocks: 0,
    error: null
  }

  const persistProgress = async progress => {
    if (state.activeJob?.id !== job.id) return
    state.activeJob = { ...state.activeJob, ...progress }
    try {
      await onPersist({
        status: state.activeJob.status,
        completedColumns: state.activeJob.completedColumns,
        error: state.activeJob.error || null
      })
    } catch (error) {
      addLog('error', `Could not save job progress: ${error.message}`)
    }
  }

  const jobConfig = {
    ...job,
    x1: Number(job.x1),
    y1: Number(job.y1),
    z1: Number(job.z1),
    x2: Number(job.x2),
    y2: Number(job.y2),
    z2: Number(job.z2),
    chestX: Number(job.chest_x),
    chestY: Number(job.chest_y),
    chestZ: Number(job.chest_z)
  }

  void runFlatSurface({
    bot,
    job: jobConfig,
    signal: controller.signal,
    defaultMovements,
    onProgress: persistProgress,
    onLog: message => addLog('info', `[${job.name}] ${message}`)
  }).then(async () => {
    await persistProgress({ status: 'completed', completedColumns: job.total_columns })
  }).catch(async error => {
    const stopped = controller.signal.aborted
    const status = stopped ? 'stopped' : 'failed'
    addLog(stopped ? 'warn' : 'error', `[${job.name}] ${stopped ? 'Job stopped.' : error.message}`)
    await persistProgress({ status, error: stopped ? null : error.message })
  }).finally(() => {
    if (activeJobController === controller) activeJobController = null
  })

  return { ...state.activeJob }
}

function stopJob (jobId) {
  if (!state.activeJob || state.activeJob.id !== Number(jobId) || !activeJobController) {
    throw new Error('That job is not running.')
  }
  stopActiveJob('Stopped from dashboard.')
  return { ...state.activeJob }
}

function settingsFromProfile (profile) {
  return {
    emergencyLeave: Boolean(profile.emergency_leave),
    autoEat: Boolean(profile.auto_eat),
    fightMobs: Boolean(profile.fight_mobs),
    neverBreakTools: Boolean(profile.never_break_tools),
    greetPlayers: Boolean(profile.greet_players)
  }
}

async function syncAutoEat (activeBot) {
  if (!botSettings.autoEat) {
    activeBot.autoEat?.disableAuto()
    activeBot.autoEat?.cancelEat()
    return
  }

  try {
    if (!activeBot.autoEat) {
      const { loader } = await import('mineflayer-auto-eat')
      if (bot !== activeBot || !botSettings.autoEat) return
      activeBot.loadPlugin(loader)
      activeBot.autoEat.setOpts({
        minHunger: 14,
        minHealth: 6,
        bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye']
      })
      activeBot.autoEat.on('eatStart', ({ food }) => addLog('info', `Eating ${food.name}.`))
      activeBot.autoEat.on('eatFail', error => addLog('warn', `Auto eat failed: ${error.message}`))
    }

    if (bot === activeBot && botSettings.autoEat) activeBot.autoEat.enableAuto()
  } catch (error) {
    addLog('error', `Auto eat could not start: ${error.message}`)
  }
}

function scanHostileMobs (activeBot) {
  if (!botSettings.fightMobs || !state.connected || !activeBot.pvp || activeBot.pvp.target) return
  const position = activeBot.entity?.position
  if (!position) return

  const target = Object.values(activeBot.entities || {})
    .filter(entity => entity.type === 'mob' && hostileMobs.has(entity.name) && entity.position)
    .map(entity => ({ entity, distance: position.distanceTo(entity.position) }))
    .filter(candidate => candidate.distance <= 8)
    .sort((first, second) => first.distance - second.distance)[0]?.entity

  if (!target) return
  activeBot.pvp.attack(target)
  addLog('info', `Defending against ${target.name}.`)
}

function greetNearbyPlayers (activeBot) {
  if (!botSettings.greetPlayers || !activeBot.entity?.position) return
  const now = Date.now()
  if (now - lastGreetingAt < 2000) return

  for (const player of Object.values(activeBot.players || {})) {
    if (!player.entity || player.username === activeBot.username) continue
    if (activeBot.entity.position.distanceTo(player.entity.position) > 5) continue

    const key = `${activeProfileId}:${player.uuid || player.entity.uuid || player.username}`
    const lastGreeted = greetingCooldowns.get(key) || 0
    if (now - lastGreeted < 10 * 60 * 1000) continue

    const greeting = greetings[Math.floor(Math.random() * greetings.length)](player.username)
    greetingCooldowns.set(key, now)
    lastGreetingAt = now
    activeBot.chat(greeting)
    addLog('info', `Greeted nearby player ${player.username}.`)
    break
  }
}

function protectHeldTool (activeBot) {
  if (!botSettings.neverBreakTools) {
    protectedTool = null
    return
  }

  const item = activeBot.heldItem
  if (item !== protectedTool) protectedTool = null
  if (!item?.maxDurability || protectedTool === item) return

  const remaining = item.maxDurability - (item.durabilityUsed || 0)
  const threshold = Math.max(1, Math.ceil(item.maxDurability * 0.1))
  if (remaining > threshold) return

  protectedTool = item
  activeBot.deactivateItem()
  activeBot.stopDigging()
  activeBot.pvp?.forceStop()
  addLog('warn', `${item.displayName || item.name} reached its durability limit; switched away to prevent breaking.`)

  const currentSlot = activeBot.quickBarSlot + 36
  const safeSlot = activeBot.inventory.slots.findIndex((candidate, slot) => {
    if (slot < 36 || slot > 44 || slot === currentSlot) return false
    if (!candidate?.maxDurability) return true
    const candidateRemaining = candidate.maxDurability - (candidate.durabilityUsed || 0)
    return candidateRemaining > Math.max(1, Math.ceil(candidate.maxDurability * 0.1))
  })

  if (safeSlot >= 0) {
    activeBot.setQuickBarSlot(safeSlot - 36)
  } else {
    activeBot.unequip('hand').catch(error => addLog('error', `Could not stow the nearly broken item: ${error.message}`))
  }
}

function updateSettings (profileId, nextSettings) {
  if (activeProfileId !== Number(profileId)) return
  botSettings = { ...nextSettings }
  state.botSettings = { ...botSettings }
  if (!bot || !state.connected) return

  void syncAutoEat(bot)
  if (botSettings.fightMobs) scanHostileMobs(bot)
  else bot.pvp?.forceStop()
}

function connect (profile) {
  if (bot || state.connecting) throw new Error('A bot connection is already active.')
  if (!profile.host || !profile.username) throw new Error('Enter a server IP and join username first.')
  if (!['microsoft', 'offline'].includes(profile.auth_mode)) throw new Error('Choose Microsoft or offline authentication.')

  state.connecting = true
  state.profileId = profile.id
  state.profileName = profile.name
  state.authCode = null
  botSettings = settingsFromProfile(profile)
  state.botSettings = { ...botSettings }
  protectedTool = null
  lastGreetingAt = 0
  activeProfileId = profile.id
  addLog('info', `Connecting profile "${profile.name}" to ${profile.host}:${profile.port || 25565}`)

  try {
    bot = mineflayer.createBot({
      host: profile.host,
      port: profile.port || 25565,
      username: profile.username,
      auth: profile.auth_mode,
      version: profile.minecraft_version || '1.21.5',
      viewDistance: process.env.BOT_VIEW_DISTANCE || 'tiny',
      profilesFolder: path.join(process.cwd(), '.auth-cache', String(profile.id)),
      onMsaCode: data => {
        state.authCode = {
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          expiresIn: data.expires_in
        }
        addLog('info', 'Microsoft sign-in requires device authorization.')
      }
    })
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(pvpPlugin)
    defaultMovements = null
  } catch (error) {
    bot = null
    state.connecting = false
    state.profileId = null
    activeProfileId = null
    addLog('error', error.message)
    throw error
  }

  const activeBot = bot
  activeBot.on('login', () => addLog('info', `Logged in as ${activeBot.username}.`))
  activeBot.once('spawn', () => {
    if (bot !== activeBot) return
    state.connecting = false
    state.connected = true
    addLog('info', 'Bot spawned in the world.')

    const movements = new Movements(activeBot)
    movements.canDig = false
    defaultMovements = movements
    activeBot.pathfinder.setMovements(movements)
    activeBot.pvp.movements = movements
    activeBot.pvp.followRange = 8
    activeBot.pvp.viewDistance = 10
    activeBot.pvp.attackRange = 3
    void syncAutoEat(activeBot)
    scanHostileMobs(activeBot)

    if (viewerEnabled) void startViewer(activeBot).catch(error => {
      viewerEnabled = false
      state.viewerEnabled = false
      addLog('error', `3D preview could not start: ${error.message}`)
    })
    refreshSnapshot()
  })
  activeBot.on('messagestr', (message, position) => {
    state.chat.push({ time: new Date().toISOString(), message, position: String(position || 'chat') })
    state.chat = state.chat.slice(-200)
  })
  activeBot.on('health', () => {
    if (bot !== activeBot || !state.connected) return
    refreshSnapshot()
    if (botSettings.emergencyLeave && activeBot.health < 4) {
      disconnect(`Emergency leave triggered at ${activeBot.health}/20 health.`)
    }
  })
  activeBot.on('physicsTick', () => {
    if (bot !== activeBot || !state.connected) return
    if (botSettings.emergencyLeave && activeBot.health < 4) {
      disconnect(`Emergency leave triggered at ${activeBot.health}/20 health.`)
      return
    }
    protectHeldTool(activeBot)
    greetNearbyPlayers(activeBot)
    scanHostileMobs(activeBot)
  })
  activeBot.on('kicked', reason => addLog('warn', `Kicked: ${reason?.toString?.() || String(reason)}`))
  activeBot.on('error', error => addLog('error', error.message))
  activeBot.on('end', reason => {
    if (bot !== activeBot) return
    stopActiveJob('Bot disconnected.')
    stopViewer()
    addLog('warn', `Disconnected${reason ? `: ${reason}` : '.'}`)
    bot = null
    activeProfileId = null
    state.connected = false
    state.connecting = false
    state.profileId = null
    state.authCode = null
    state.health = null
    state.food = null
    state.level = null
    state.ping = null
    state.position = null
    state.dimension = null
    state.inventory = []
    state.armor = []
    state.offhand = null
    state.mainHand = null
  })
}

function disconnect (reason = 'Disconnected from dashboard.') {
  stopActiveJob(reason)
  stopViewer()
  if (!bot) {
    state.connecting = false
    state.connected = false
    return
  }
  const currentBot = bot
  bot = null
  activeProfileId = null
  state.connected = false
  state.connecting = false
  state.profileId = null
  state.authCode = null
  state.health = null
  state.food = null
  state.level = null
  state.ping = null
  state.position = null
  state.dimension = null
  state.inventory = []
  state.armor = []
  state.offhand = null
  state.mainHand = null
  addLog(reason.startsWith('Emergency leave') ? 'warn' : 'info', reason)
  currentBot.end(reason)
}

function sendChat (message) {
  if (!bot || !state.connected) throw new Error('Connect the bot before sending chat.')
  const text = String(message || '').trim()
  if (!text || text.length > 256) throw new Error('Messages must contain 1 to 256 characters.')
  bot.chat(text)
  state.chat.push({ time: new Date().toISOString(), message: text, position: 'outgoing' })
  state.chat = state.chat.slice(-200)
}

async function inventoryAction ({ action, slot }) {
  if (!bot || !state.connected) throw new Error('Connect the bot before changing inventory.')
  const item = bot.inventory.slots[Number(slot)]
  if (!item) throw new Error('That inventory slot is empty.')

  if (action === 'drop') {
    await bot.tossStack(item)
    addLog('info', `Dropped ${item.count} ${item.displayName}.`)
    return
  }

  const destinations = {
    'main-hand': 'hand',
    'off-hand': 'off-hand',
    head: 'head',
    torso: 'torso',
    legs: 'legs',
    feet: 'feet'
  }
  const destination = destinations[action]
  if (!destination) throw new Error('That inventory action is not supported.')
  await bot.equip(item, destination)
  addLog('info', `Equipped ${item.displayName} to ${destination}.`)
  refreshSnapshot()
}

function clearTransientData () {
  state.chat = []
  state.logs = []
  addLog('info', 'Temporary chat and system log history cleared.')
}

function clearChat () {
  state.chat = []
}

module.exports = { getState, getViewerStatus, setViewerEnabled, connect, disconnect, sendChat, inventoryAction, clearTransientData, clearChat, updateSettings, startFlatSurface, stopJob, get activeProfileId () { return activeProfileId } }