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
          table.boolean('emergency_leave').notNullable().defaultTo(false)
          table.boolean('auto_eat').notNullable().defaultTo(false)
          table.boolean('fight_mobs').notNullable().defaultTo(false)
          table.boolean('never_break_tools').notNullable().defaultTo(false)
          table.boolean('greet_players').notNullable().defaultTo(false)
          table.timestamp('created_at').notNullable().defaultTo(db.fn.now())
          table.timestamp('updated_at').notNullable().defaultTo(db.fn.now())
        })
      }
      if (!(await db.schema.hasColumn('profiles', 'minecraft_version'))) {
        await db.schema.alterTable('profiles', table => {
          table.string('minecraft_version', 16).notNullable().defaultTo('1.21.5')
        })
      }
      const botSettingsColumns = [
        'emergency_leave',
        'auto_eat',
        'fight_mobs',
        'never_break_tools',
        'greet_players'
      ]
      for (const column of botSettingsColumns) {
        if (!(await db.schema.hasColumn('profiles', column))) {
          await db.schema.alterTable('profiles', table => {
            table.boolean(column).notNullable().defaultTo(false)
          })
        }
      }
      if (!(await db.schema.hasTable('jobs'))) {
        await db.schema.createTable('jobs', table => {
          table.increments('id').primary()
          const profileId = table.integer('profile_id')
          if (client === 'mysql2') profileId.unsigned()
          profileId.notNullable().references('id').inTable('profiles').onDelete('CASCADE')
          table.string('type', 40).notNullable().defaultTo('flat_surface')
          table.string('name', 80).notNullable()
          table.integer('x1').notNullable()
          table.integer('y1').notNullable()
          table.integer('z1').notNullable()
          table.integer('x2').notNullable()
          table.integer('y2').notNullable()
          table.integer('z2').notNullable()
          table.integer('chest_x').notNullable()
          table.integer('chest_y').notNullable()
          table.integer('chest_z').notNullable()
          table.string('status', 20).notNullable().defaultTo('idle')
          table.integer('completed_columns').notNullable().defaultTo(0)
          table.integer('total_columns').notNullable()
          table.text('error').nullable()
          table.timestamp('created_at').notNullable().defaultTo(db.fn.now())
          table.timestamp('updated_at').notNullable().defaultTo(db.fn.now())
        })
      }
      if (client === 'mysql2') {
        const profileForeignKey = await db('information_schema.KEY_COLUMN_USAGE')
          .select('CONSTRAINT_NAME')
          .where({
            TABLE_SCHEMA: process.env.DB_NAME || 'minecraft_automation',
            TABLE_NAME: 'jobs',
            COLUMN_NAME: 'profile_id',
            REFERENCED_TABLE_NAME: 'profiles'
          })
          .first()
        if (!profileForeignKey) {
          await db.schema.alterTable('jobs', table => {
            table.integer('profile_id').unsigned().notNullable().alter()
            table.foreign('profile_id', 'jobs_profile_id_foreign').references('id').inTable('profiles').onDelete('CASCADE')
          })
        }
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