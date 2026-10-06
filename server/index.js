require('dotenv').config()

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const express = require('express')
const httpProxy = require('http-proxy')
const mineflayer = require('mineflayer')
const { db, databaseName, client, ensureDatabase } = require('./database')
const botService = require('./bot')
const { validateFlatSurface } = require('./jobs/flat-surface')

const app = express()
const root = path.join(__dirname, '..')
const port = Number(process.env.NODE_ENV === 'production'
  ? process.env.DASHBOARD_PORT || 3000
  : process.env.API_PORT || 3002)
const viewerPort = Number(process.env.VIEWER_PORT || 3001)
const viewerProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${viewerPort}`,
  changeOrigin: true,
  ws: true
})

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

function asyncRoute (handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function mapProfile (profile) {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host || '',
    port: profile.port,
    username: profile.username || '',
    authMode: profile.auth_mode || 'microsoft',
    minecraftVersion: profile.minecraft_version || '1.21.5',
    botSettings: {
      emergencyLeave: Boolean(profile.emergency_leave),
      autoEat: Boolean(profile.auto_eat),
      fightMobs: Boolean(profile.fight_mobs),
      neverBreakTools: Boolean(profile.never_break_tools),
      greetPlayers: Boolean(profile.greet_players)
    },
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  }
}

function mapJob (job) {
  return {
    id: job.id,
    profileId: job.profile_id,
    type: job.type,
    name: job.name,
    x1: job.x1,
    y1: job.y1,
    z1: job.z1,
    x2: job.x2,
    y2: job.y2,
    z2: job.z2,
    chestX: job.chest_x,
    chestY: job.chest_y,
    chestZ: job.chest_z,
    status: job.status,
    completedColumns: job.completed_columns,
    totalColumns: job.total_columns,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  }
}

function readFlatSurfaceInput (body) {
  const keys = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'chestX', 'chestY', 'chestZ']
  for (const key of keys) {
    if (body[key] === '' || body[key] === null || body[key] === undefined) {
      throw Object.assign(new Error(`${key} is required.`), { status: 400 })
    }
  }

  const job = {
    x1: Number(body.x1),
    y1: Number(body.y1),
    z1: Number(body.z1),
    x2: Number(body.x2),
    y2: Number(body.y2),
    z2: Number(body.z2),
    chestX: Number(body.chestX),
    chestY: Number(body.chestY),
    chestZ: Number(body.chestZ)
  }

  try {
    const { totalColumns } = validateFlatSurface(job)
    return { ...job, totalColumns }
  } catch (error) {
    throw Object.assign(error, { status: 400 })
  }
}

function validateSettings (body) {
  const host = String(body.host || '').trim()
  const username = String(body.username || '').trim()
  const portValue = body.port === '' || body.port === null || body.port === undefined ? null : Number(body.port)
  const authMode = String(body.authMode || 'microsoft').toLowerCase()
  const minecraftVersion = String(body.minecraftVersion || '1.21.5')
  const botSettings = body.botSettings ?? {}

  if (host.length > 255) throw Object.assign(new Error('Server IP must be 255 characters or less.'), { status: 400 })
  if (username.length > 80) throw Object.assign(new Error('Username must be 80 characters or less.'), { status: 400 })
  if (portValue !== null && (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535)) {
    throw Object.assign(new Error('Port must be between 1 and 65535.'), { status: 400 })
  }
  if (!['microsoft', 'offline'].includes(authMode)) {
    throw Object.assign(new Error('Authentication must be Microsoft or offline.'), { status: 400 })
  }
  if (!mineflayer.testedVersions.includes(minecraftVersion)) {
    throw Object.assign(new Error('Select a Minecraft version tested by Mineflayer.'), { status: 400 })
  }
  if (typeof botSettings !== 'object' || Array.isArray(botSettings)) {
    throw Object.assign(new Error('Bot settings must be an object.'), { status: 400 })
  }
  const readSetting = key => {
    const value = botSettings[key] ?? false
    if (typeof value !== 'boolean') throw Object.assign(new Error(`Bot setting '${key}' must be true or false.`), { status: 400 })
    return value
  }

  return {
    host,
    port: portValue,
    username,
    auth_mode: authMode,
    minecraft_version: minecraftVersion,
    emergency_leave: readSetting('emergencyLeave'),
    auto_eat: readSetting('autoEat'),
    fight_mobs: readSetting('fightMobs'),
    never_break_tools: readSetting('neverBreakTools'),
    greet_players: readSetting('greetPlayers')
  }
}

app.get('/api/health', asyncRoute(async (req, res) => {
  try {
    await ensureDatabase()
    res.json({ database: 'connected', engine: databaseName })
  } catch (error) {
    console.error(`Database health check failed (${databaseName}):`, error.message)
    res.status(503).json({ database: 'failed', engine: databaseName, message: 'The selected database is unavailable.' })
  }
}))

app.get('/api/profiles', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const profiles = await db('profiles').select('*').orderBy('created_at', 'asc')
  res.json(profiles.map(mapProfile))
}))

app.get('/api/versions', (req, res) => {
  res.json(mineflayer.testedVersions)
})

app.get('/api/jobs', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId)) throw Object.assign(new Error('Select a profile to load its jobs.'), { status: 400 })
  const jobs = await db('jobs').where({ profile_id: profileId }).orderBy('created_at', 'desc')
  res.json(jobs.map(mapJob))
}))

app.post('/api/jobs', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const profileId = Number(req.body.profileId)
  if (!Number.isInteger(profileId) || !(await db('profiles').where({ id: profileId }).first())) {
    throw Object.assign(new Error('Select a valid profile for this job.'), { status: 400 })
  }
  const name = String(req.body.name || 'Flat Surface').trim()
  if (!name || name.length > 80) throw Object.assign(new Error('Job name must contain 1 to 80 characters.'), { status: 400 })
  const coordinates = readFlatSurfaceInput(req.body)
  const record = {
    profile_id: profileId,
    type: 'flat_surface',
    name,
    x1: coordinates.x1,
    y1: coordinates.y1,
    z1: coordinates.z1,
    x2: coordinates.x2,
    y2: coordinates.y2,
    z2: coordinates.z2,
    chest_x: coordinates.chestX,
    chest_y: coordinates.chestY,
    chest_z: coordinates.chestZ,
    total_columns: coordinates.totalColumns
  }

  let job
  if (client === 'pg') {
    const [created] = await db('jobs').insert(record).returning('*')
    job = created
  } else {
    const [id] = await db('jobs').insert(record)
    job = await db('jobs').where({ id }).first()
  }
  res.status(201).json(mapJob(job))
}))

app.delete('/api/jobs/:id', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const id = Number(req.params.id)
  if (botService.getState().activeJob?.id === id) {
    throw Object.assign(new Error('Stop the running job before deleting it.'), { status: 409 })
  }
  const deleted = await db('jobs').where({ id }).delete()
  if (!deleted) return res.status(404).json({ error: 'Job not found.' })
  res.status(204).end()
}))

app.post('/api/jobs/:id/start', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const id = Number(req.params.id)
  const job = await db('jobs').where({ id }).first()
  if (!job) return res.status(404).json({ error: 'Job not found.' })
  if (job.type !== 'flat_surface') throw Object.assign(new Error('This job type is not supported.'), { status: 400 })
  await db('jobs').where({ id }).update({ status: 'running', completed_columns: 0, error: null, updated_at: db.fn.now() })

  try {
    const activeJob = botService.startFlatSurface({ ...job, status: 'running', completed_columns: 0 }, async progress => {
      await db('jobs').where({ id }).update({
        status: progress.status,
        completed_columns: progress.completedColumns,
        error: progress.error,
        updated_at: db.fn.now()
      })
    })
    res.status(202).json(activeJob)
  } catch (error) {
    await db('jobs').where({ id }).update({ status: 'failed', error: error.message, updated_at: db.fn.now() })
    throw Object.assign(error, { status: error.status || 400 })
  }
}))

app.post('/api/jobs/:id/stop', asyncRoute(async (req, res) => {
  const activeJob = botService.stopJob(Number(req.params.id))
  await db('jobs').where({ id: activeJob.id }).update({ status: 'stopping', updated_at: db.fn.now() })
  res.json(activeJob)
}))

app.post('/api/profiles', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const name = String(req.body.name || '').trim()
  if (!name || name.length > 60) throw Object.assign(new Error('Profile name must contain 1 to 60 characters.'), { status: 400 })

  let profile
  try {
    if (client === 'pg') {
      const [created] = await db('profiles').insert({ name }).returning('*')
      profile = created
    } else {
      const [id] = await db('profiles').insert({ name })
      profile = await db('profiles').where({ id }).first()
    }
  } catch (error) {
    if (error.code === '23505' || error.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('A profile with that name already exists.'), { status: 409 })
    }
    throw error
  }

  res.status(201).json(mapProfile(profile))
}))

app.put('/api/profiles/:id', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) throw Object.assign(new Error('Invalid profile.'), { status: 400 })
  const settings = validateSettings(req.body)
  const updated = await db('profiles').where({ id }).update({ ...settings, updated_at: db.fn.now() })
  if (!updated) return res.status(404).json({ error: 'Profile not found.' })
  const profile = await db('profiles').where({ id }).first()
  const mapped = mapProfile(profile)
  if (botService.activeProfileId === id) botService.updateSettings(id, mapped.botSettings)
  res.json(mapped)
}))

app.delete('/api/profiles/:id', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const id = Number(req.params.id)
  if (botService.activeProfileId === id) {
    throw Object.assign(new Error('Disconnect this profile before deleting it.'), { status: 409 })
  }
  const deleted = await db('profiles').where({ id }).delete()
  if (!deleted) return res.status(404).json({ error: 'Profile not found.' })
  res.status(204).end()
}))

app.post('/api/cache/clear', (req, res) => {
  botService.clearTransientData()
  res.json({ cleared: true })
})

app.post('/api/bot/chat/clear', (req, res) => {
  botService.clearChat()
  res.json({ cleared: true })
})

app.get('/api/bot/state', (req, res) => res.json(botService.getState()))
app.get('/api/viewer', (req, res) => res.json(botService.getViewerStatus()))
app.post('/api/viewer', asyncRoute(async (req, res) => {
  const status = await botService.setViewerEnabled(req.body.enabled)
  res.json(status)
}))

app.post('/api/bot/connect', asyncRoute(async (req, res) => {
  await ensureDatabase()
  const id = Number(req.body.profileId)
  if (!Number.isInteger(id)) throw Object.assign(new Error('Select a profile first.'), { status: 400 })
  const profile = await db('profiles').where({ id }).first()
  if (!profile) throw Object.assign(new Error('Profile not found.'), { status: 404 })
  botService.connect(profile)
  res.status(202).json(botService.getState())
}))

app.post('/api/bot/disconnect', (req, res) => {
  botService.disconnect()
  res.json(botService.getState())
})

app.post('/api/bot/chat', (req, res, next) => {
  try {
    botService.sendChat(req.body.message)
    res.status(202).json({ sent: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/bot/inventory/action', asyncRoute(async (req, res) => {
  await botService.inventoryAction(req.body)
  res.status(202).json({ updated: true })
}))

app.use('/viewer', (req, res) => {
  if (!botService.getViewerStatus().running) {
    return res.status(503).type('text/plain').send('3D preview is disabled.')
  }
  req.url = req.originalUrl
  viewerProxy.web(req, res)
})

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }))

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*path', (req, res, next) => {
      if (req.accepts('html')) return res.sendFile(path.join(dist, 'index.html'))
      next()
    })
  }
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  const status = error.status || 500
  if (status >= 500) console.error('Request failed:', error.message)
  res.status(status).json({ error: status >= 500 ? 'The request could not be completed.' : error.message })
})

viewerProxy.on('error', (error, req, res) => {
  console.error('3D preview proxy failed:', error.message)
  if (res && typeof res.writeHead === 'function') {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('3D preview is unavailable.')
  } else if (res?.destroy) {
    res.destroy(error)
  }
})

const server = http.createServer(app)
server.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0] || ''
  if (!pathname.startsWith('/viewer/socket.io')) return
  if (!botService.getViewerStatus().running) {
    socket.destroy()
    return
  }
  viewerProxy.ws(req, socket, head)
})

server.listen(port, process.env.DASHBOARD_HOST || '0.0.0.0', () => {
  const serviceName = process.env.NODE_ENV === 'production' ? 'Dashboard and API' : 'Dashboard API'
  console.log(`${serviceName} listening on ${port} (${databaseName})`)
  ensureDatabase().catch(error => {
    console.error(`Database is not available yet (${databaseName}):`, error.message)
  })
})