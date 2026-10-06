const knexFactory = require('knex')

const database = (process.env.DATABASE || 'PSQL').trim().toUpperCase()
if (!['PSQL', 'POSTGRES', 'POSTGRESQL', 'MYSQL', 'MYSQL2'].includes(database)) {
  throw new Error('DATABASE must be PSQL or MYSQL.')
}
const client = ['MYSQL', 'MYSQL2'].includes(database) ? 'mysql2' : 'pg'
const databaseName = client === 'pg' ? 'PSQL' : 'MYSQL'

const db = knexFactory({
  client,
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || (client === 'pg' ? 5432 : 3306)),
    user: process.env.DB_USER || 'minecraft_bot',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'minecraft_automation',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false
  },
  pool: { min: 0, max: 8 }
})

let initialization

async function ensureDatabase () {
  if (!initialization) {
    initialization = (async () => {
      await db.raw('select 1')
      if (!(await db.schema.hasTable('profiles'))) {
        await db.schema.createTable('profiles', table => {
          table.increments('id').primary()
          table.string('name', 60).notNullable().unique()
          table.string('host', 255).notNullable().defaultTo('')
          table.integer('port').nullable()
          table.string('username', 80).notNullable().defaultTo('')
          table.string('auth_mode', 20).notNullable().defaultTo('microsoft')
          table.string('minecraft_version', 16).notNullable().defaultTo('1.21.5')
          table.timestamp('created_at').notNullable().defaultTo(db.fn.now())
          table.timestamp('updated_at').notNullable().defaultTo(db.fn.now())
        })
      }
      if (!(await db.schema.hasColumn('profiles', 'minecraft_version'))) {
        await db.schema.alterTable('profiles', table => {
          table.string('minecraft_version', 16).notNullable().defaultTo('1.21.5')
        })
      }
    })()
  }

  try {
    await initialization
  } catch (error) {
    initialization = undefined
    throw error
  }
}

module.exports = { db, databaseName, client, ensureDatabase }