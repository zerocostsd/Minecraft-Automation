require('dotenv').config()

const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const mineflayer = require('mineflayer')
const { db, databaseName, client, ensureDatabase } = require('./database')
const botService = require('./bot')

const app = express()
const root = path.join(__dirname, '..')
const port = Number(process.env.NODE_ENV === 'production'
  ? process.env.DASHBOARD_PORT || 3000
  : process.env.API_PORT || 3002)

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
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  }
}

function validateSettings (body) {
  const host = String(body.host || '').trim()
  const username = String(body.username || '').trim()
  const portValue = body.port === '' || body.port === null || body.port === undefined ? null : Number(body.port)
  const authMode = String(body.authMode || 'microsoft').toLowerCase()
  const minecraftVersion = String(body.minecraftVersion || '1.21.5')

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

  return { host, port: portValue, username, auth_mode: authMode, minecraft_version: minecraftVersion }
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
  res.json(mapProfile(profile))
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

app.listen(port, process.env.DASHBOARD_HOST || '0.0.0.0', () => {
  console.log(`Dashboard API listening on ${port} (${databaseName})`)
  ensureDatabase().catch(error => {
    console.error(`Database is not available yet (${databaseName}):`, error.message)
  })
})