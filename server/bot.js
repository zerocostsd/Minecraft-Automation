const path = require('node:path')
const mineflayer = require('mineflayer')

let bot = null
let activeProfileId = null
let viewerStarted = false

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
  mainHand: null
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
  return { ...state, inventory: [...state.inventory], armor: [...state.armor], chat: [...state.chat], logs: [...state.logs] }
}

function connect (profile) {
  if (bot || state.connecting) throw new Error('A bot connection is already active.')
  if (!profile.host || !profile.username) throw new Error('Enter a server IP and join username first.')
  if (!['microsoft', 'offline'].includes(profile.auth_mode)) throw new Error('Choose Microsoft or offline authentication.')

  state.connecting = true
  state.profileId = profile.id
  state.profileName = profile.name
  state.authCode = null
  activeProfileId = profile.id
  addLog('info', `Connecting profile "${profile.name}" to ${profile.host}:${profile.port || 25565}`)

  try {
    bot = mineflayer.createBot({
      host: profile.host,
      port: profile.port || 25565,
      username: profile.username,
      auth: profile.auth_mode,
      version: profile.minecraft_version || '1.21.5',
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

    if (!viewerStarted) {
      try {
        const { mineflayer: startViewer } = require('prismarine-viewer')
        startViewer(activeBot, {
          port: Number(process.env.VIEWER_PORT || 3001),
          firstPerson: true
        })
        viewerStarted = true
        addLog('info', `3D viewer listening on port ${process.env.VIEWER_PORT || 3001}.`)
      } catch (error) {
        addLog('error', `3D viewer could not start: ${error.message}`)
      }
    }
    refreshSnapshot()
  })
  activeBot.on('messagestr', (message, position) => {
    state.chat.push({ time: new Date().toISOString(), message, position: String(position || 'chat') })
    state.chat = state.chat.slice(-200)
  })
  activeBot.on('kicked', reason => addLog('warn', `Kicked: ${reason?.toString?.() || String(reason)}`))
  activeBot.on('error', error => addLog('error', error.message))
  activeBot.on('end', reason => {
    if (bot !== activeBot) return
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

function disconnect () {
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
  addLog('info', 'Disconnect requested from dashboard.')
  currentBot.end('Disconnected from dashboard')
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

module.exports = { getState, connect, disconnect, sendChat, inventoryAction, clearTransientData, clearChat, get activeProfileId () { return activeProfileId } }