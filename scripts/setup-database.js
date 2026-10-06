const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const envPath = path.resolve(process.cwd(), '.env')
const defaults = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}

function prompt (label, defaultValue = '', hidden = false) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run `npm run setup` in an interactive terminal.'))
  }

  const defaultLabel = defaultValue ? (hidden ? ' [saved value]' : ` [${defaultValue}]`) : ''
  process.stdout.write(`${label}${defaultLabel}: `)

  return new Promise((resolve, reject) => {
    let value = ''
    const previousRawMode = process.stdin.isRaw

    function finish (error) {
      process.stdin.removeListener('data', onData)
      process.stdin.setRawMode(Boolean(previousRawMode))
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value || defaultValue)
    }

    function onData (chunk) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Setup cancelled.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') {
          if (value.length) {
            value = value.slice(0, -1)
            if (!hidden) process.stdout.write('\b \b')
          }
          continue
        }
        if (character.charCodeAt(0) >= 32) {
          value += character
          if (!hidden) process.stdout.write(character)
        }
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function askRequired (label, defaultValue = '') {
  while (true) {
    const value = String(await prompt(label, defaultValue)).trim()
    if (value) return value
    process.stdout.write('This value is required.\n')
  }
}

async function askDatabase () {
  while (true) {
    const value = String(await prompt('Database engine (PSQL/MYSQL)', defaults.DATABASE || 'PSQL')).trim().toUpperCase()
    if (['PSQL', 'POSTGRES', 'POSTGRESQL'].includes(value)) return 'PSQL'
    if (['MYSQL', 'MYSQL2'].includes(value)) return 'MYSQL'
    process.stdout.write('Enter PSQL or MYSQL.\n')
  }
}

function usesMysql (value) {
  return ['MYSQL', 'MYSQL2'].includes(String(value || '').trim().toUpperCase())
}

async function askPort (label, defaultValue) {
  while (true) {
    const value = Number(await prompt(label, String(defaultValue)))
    if (Number.isInteger(value) && value > 0 && value <= 65535) return value
    process.stdout.write('Enter a port from 1 to 65535.\n')
  }
}

async function askSsl () {
  while (true) {
    const value = String(await prompt('Use TLS/SSL? (y/n)', defaults.DB_SSL === 'true' ? 'y' : 'n')).trim().toLowerCase()
    if (['y', 'yes'].includes(value)) return 'true'
    if (['n', 'no'].includes(value)) return 'false'
    process.stdout.write('Enter y or n.\n')
  }
}

function writeEnvironment (environment) {
  const temporaryPath = `${envPath}.${process.pid}.tmp`
  const contents = `${Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`

  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporaryPath, envPath)
    if (process.platform !== 'win32') {
      fs.chmodSync(envPath, 0o600)
      const permissions = fs.statSync(envPath).mode & 0o777
      if ((permissions & 0o077) !== 0) {
        throw new Error('The filesystem did not preserve owner-only .env permissions. Secure the file manually before continuing.')
      }
    }
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    throw error
  }
}

function printWindowsPermissionNote () {
  process.stdout.write('Windows ACL permissions are not verified. To restrict .env access, run: icacls .env /inheritance:r /grant:r "%USERNAME%:F"\n')
}

async function main () {
  const checkOnly = process.argv.includes('--check')
  const environment = { ...defaults }

  if (checkOnly) {
    if (!fs.existsSync(envPath)) throw new Error('No .env file exists. Run `npm run setup` first.')
    if (process.platform === 'win32') {
      printWindowsPermissionNote()
    } else {
      const permissions = fs.statSync(envPath).mode & 0o777
      if ((permissions & 0o077) !== 0) {
        throw new Error('The .env file is readable by other users. Run `chmod 600 .env` before continuing.')
      }
    }
    for (const [key, value] of Object.entries(environment)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  } else {
    const engine = await askDatabase()
    const isMysql = engine === 'MYSQL'
    const currentEngineMatches = defaults.DATABASE && usesMysql(defaults.DATABASE) === isMysql
    const portDefault = currentEngineMatches && defaults.DB_PORT ? defaults.DB_PORT : isMysql ? 3306 : 5432
    environment.DATABASE = engine
    environment.DB_HOST = await askRequired('Database host', defaults.DB_HOST || '127.0.0.1')
    environment.DB_PORT = String(await askPort('Database port', portDefault))
    environment.DB_NAME = await askRequired('Database name', defaults.DB_NAME || 'minecraft_automation')
    environment.DB_USER = await askRequired('Database user', defaults.DB_USER || '')
    const password = await prompt('Database password (enter @empty for no password)', defaults.DB_PASSWORD || '', true)
    environment.DB_PASSWORD = password === '@empty' ? '' : password
    environment.DB_SSL = await askSsl()
    delete environment.MINECRAFT_VERSION

    for (const [key, value] of Object.entries(environment)) process.env[key] = value
  }

  const { db, databaseName, ensureDatabase } = require('../server/database')
  try {
    await ensureDatabase()
    await db.destroy()
  } catch (error) {
    await db.destroy().catch(() => {})
    throw new Error(`Could not connect or initialize ${databaseName}: ${error.message}. Confirm the database exists and the credentials have permission to create or alter tables.`)
  }

  if (checkOnly) {
    process.stdout.write(`Database connection and profile schema are ready (${databaseName}).\n`)
    return
  }

  writeEnvironment(environment)
  process.stdout.write(`Database connection verified and profile schema initialized (${databaseName}).\n`)
  process.stdout.write(`Saved database settings to ${envPath}.\n`)
  if (process.platform === 'win32') {
    printWindowsPermissionNote()
  } else {
    process.stdout.write('Owner-only file permissions are set.\n')
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})