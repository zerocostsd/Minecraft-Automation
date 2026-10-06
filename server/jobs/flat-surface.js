const { Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')

const { GoalBlock, GoalNear } = goals
const MAX_COLUMNS = 65536
const MIN_FREE_SLOTS = 3
const SCAFFOLD_RESERVE = 16
const scaffoldNames = ['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'netherrack', 'andesite']
const fluidNames = new Set(['water', 'lava'])
const airNames = new Set(['air', 'cave_air', 'void_air'])
const fallingBlockNames = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel', 'anvil', 'chipped_anvil', 'damaged_anvil'])
const preservedItemPattern = /pickaxe|shovel|axe|hoe|sword|shield|helmet|chestplate|leggings|boots|elytra|bow|crossbow|trident|flint_and_steel|shears|bucket|apple|bread|carrot|potato|beef|steak|pork|chicken|mutton|cod|salmon|food|totem|torch/i

function validateFlatSurface (job) {
  const coordinates = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'chestX', 'chestY', 'chestZ']
  for (const key of coordinates) {
    if (job[key] === '' || job[key] === null || job[key] === undefined || !Number.isSafeInteger(Number(job[key]))) {
      throw new Error(`${key} must be a whole-number coordinate.`)
    }
  }

  const { x1, y1, z1, x2, y2, z2, chestX, chestY, chestZ } = job
  if (x1 > x2) throw new Error('X1 must be less than or equal to X2.')
  if (z1 > z2) throw new Error('Z1 must be less than or equal to Z2.')
  if (y1 > y2) throw new Error('Y1 must be the lower level and Y2 the upper level.')
  if (y2 - y1 + 1 > 4) throw new Error('The digging volume can be at most 4 blocks high.')
  if (Math.abs(x1) > 29999999 || Math.abs(x2) > 29999999 || Math.abs(z1) > 29999999 || Math.abs(z2) > 29999999) {
    throw new Error('X and Z coordinates must be within the Minecraft world border.')
  }

  const width = x2 - x1 + 1
  const depth = z2 - z1 + 1
  const totalColumns = width * depth
  if (totalColumns > MAX_COLUMNS) throw new Error(`The selected area is too large. Maximum area is ${MAX_COLUMNS} columns.`)
  if (chestX >= x1 && chestX <= x2 && chestZ >= z1 && chestZ <= z2 && chestY >= y1 && chestY <= y2) {
    throw new Error('The output chest cannot be inside the digging volume.')
  }
  if (chestX === x1 - 1 && chestY === y1 && chestZ === z1) {
    throw new Error('The output chest cannot occupy the starting standing position.')
  }

  return { width, depth, totalColumns }
}

function buildSnakeRoute ({ x1, z1, x2, z2 }) {
  const route = []
  for (let x = x1; x <= x2; x++) {
    const forward = (x - x1) % 2 === 0
    if (forward) {
      for (let z = z1; z <= z2; z++) route.push({ x, z })
    } else {
      for (let z = z2; z >= z1; z--) route.push({ x, z })
    }
  }
  return route
}

function throwIfStopped (signal) {
  if (signal.aborted) throw new Error('Job stopped by user.')
}

function sleep (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function goto (bot, goal, signal, onLog) {
  let attempts = 0
  while (true) {
    throwIfStopped(signal)
    if (bot.pvp?.target) {
      await sleep(500)
      continue
    }

    const route = bot.pathfinder.goto(goal)
    route.catch(() => {})
    let abortListener
    const aborted = new Promise((resolve, reject) => {
      abortListener = () => {
        bot.pathfinder.setGoal(null)
        reject(new Error('Job stopped by user.'))
      }
      signal.addEventListener('abort', abortListener, { once: true })
    })

    try {
      await Promise.race([route, aborted])
      return
    } catch (error) {
      throwIfStopped(signal)
      if (attempts < 5) {
        attempts++
        onLog(bot.pvp?.target
          ? `Pausing route while defending against ${bot.pvp.target.name}.`
          : 'Route changed before arrival. Recalculating from the current position.')
        await sleep(300)
        continue
      }
      throw new Error(`Could not reach the next work position: ${error.message}`)
    } finally {
      signal.removeEventListener('abort', abortListener)
    }
  }
}

function scaffoldItemIds (bot) {
  return scaffoldNames.map(name => bot.registry.itemsByName[name]?.id).filter(Number.isInteger)
}

function setupJobMovements (bot) {
  const movements = new Movements(bot)
  movements.canDig = true
  movements.allow1by1towers = true
  movements.allowParkour = false
  movements.allowSprinting = false
  movements.maxDropDown = 2
  movements.dontMineUnderFallingBlock = true
  movements.liquidCost = 100
  movements.scafoldingBlocks = scaffoldItemIds(bot)
  for (const name of ['lava', 'flowing_lava']) {
    const fluid = bot.registry.blocksByName[name]
    if (fluid) movements.blocksToAvoid.add(fluid.id)
  }
  return movements
}

function hasSafeSupport (block) {
  return Boolean(block && block.boundingBox === 'block' && !fluidNames.has(block.name))
}

function ensureRouteSupport (bot, x, y, z, onLog) {
  const support = bot.blockAt(new Vec3(x, y - 1, z))
  if (hasSafeSupport(support)) return

  const scaffoldIds = scaffoldItemIds(bot)
  const scaffoldAvailable = bot.inventory.items().some(item => scaffoldIds.includes(item.type) && item.count > 0)
  if (!scaffoldAvailable) throw new Error(`No safe floor at ${x}, ${y - 1}, ${z} and no bridge blocks remain.`)
  onLog(`No solid floor at ${x}, ${y - 1}, ${z}; Pathfinder will bridge this step.`)
}

function emptyStorageSlots (bot) {
  return bot.inventory.slots.slice(9, 45).filter(slot => !slot).length
}

function outputChestBlock (bot, job) {
  const chest = bot.blockAt(new Vec3(job.chestX, job.chestY, job.chestZ))
  if (!chest || !['chest', 'trapped_chest'].includes(chest.name)) {
    throw new Error('The output coordinates must contain a loaded chest or trapped chest.')
  }
  return chest
}

function shouldPreserve (item) {
  return Boolean(item.maxDurability || preservedItemPattern.test(item.name))
}

async function unloadInventory (bot, job, signal, requiredFreeSlots, onLog) {
  const origin = bot.entity.position.floored()
  onLog('Inventory is nearly full. Returning to the output chest.')
  await goto(bot, new GoalNear(job.chestX, job.chestY, job.chestZ, 2), signal, onLog)
  throwIfStopped(signal)

  const chest = outputChestBlock(bot, job)
  const container = await bot.openContainer(chest)
  try {
    let scaffoldReserve = SCAFFOLD_RESERVE
    const items = bot.inventory.items()
    for (const item of items) {
      throwIfStopped(signal)
      let count = item.count
      if (scaffoldItemIds(bot).includes(item.type)) {
        const keep = Math.min(scaffoldReserve, count)
        scaffoldReserve -= keep
        count -= keep
      } else if (shouldPreserve(item)) {
        continue
      }
      if (count > 0) await container.deposit(item.type, item.metadata ?? null, count, item.nbt ?? null)
    }
  } finally {
    container.close()
  }

  if (emptyStorageSlots(bot) < requiredFreeSlots) {
    throw new Error('The chest could not free enough inventory space for the next column. Check its capacity and keep bridge blocks available.')
  }

  await goto(bot, new GoalBlock(Math.floor(origin.x), job.y1, Math.floor(origin.z)), signal, onLog)
  onLog('Inventory unloaded. Resuming the work route.')
}

function totalMinedBlocks (job, completedColumns) {
  return completedColumns * (job.y2 - job.y1 + 1)
}

async function runFlatSurface ({ bot, job, signal, onProgress, onLog, defaultMovements }) {
  const { totalColumns } = validateFlatSurface(job)
  const route = buildSnakeRoute(job)
  const scaffoldIds = scaffoldItemIds(bot)
  const scaffoldCount = bot.inventory.items()
    .filter(item => scaffoldIds.includes(item.type))
    .reduce((total, item) => total + item.count, 0)

  if (!scaffoldIds.length || scaffoldCount < SCAFFOLD_RESERVE) {
    throw new Error(`Bring at least ${SCAFFOLD_RESERVE} dirt, stone, or cobblestone blocks so the bot can bridge gaps and recover safely.`)
  }

  const jobMovements = setupJobMovements(bot)
  const previousPvpMovements = bot.pvp?.movements
  jobMovements.canDig = false
  bot.pathfinder.setMovements(jobMovements)
  if (bot.pvp) bot.pvp.movements = jobMovements
  let completedColumns = 0
  let currentPosition = { x: job.x1 - 1, y: job.y1, z: job.z1 }
  const freeSlotsBeforeColumn = job.y2 - job.y1 + 1 + MIN_FREE_SLOTS

  try {
    onLog('Checking the output chest before digging starts.')
    await goto(bot, new GoalNear(job.chestX, job.chestY, job.chestZ, 2), signal, onLog)
    outputChestBlock(bot, job)
    onLog('Output chest verified. Moving to the safe starting position beside the first column.')
    jobMovements.canDig = true
    bot.pathfinder.setMovements(jobMovements)
    onLog('Moving to the safe starting position beside the first column.')
    ensureRouteSupport(bot, currentPosition.x, currentPosition.y, currentPosition.z, onLog)
    await goto(bot, new GoalBlock(currentPosition.x, currentPosition.y, currentPosition.z), signal, onLog)

    for (let index = 0; index < route.length; index++) {
      throwIfStopped(signal)
      if (emptyStorageSlots(bot) < freeSlotsBeforeColumn) await unloadInventory(bot, job, signal, freeSlotsBeforeColumn, onLog)
      await goto(bot, new GoalBlock(currentPosition.x, currentPosition.y, currentPosition.z), signal, onLog)

      const column = route[index]
      for (let y = job.y2; y >= job.y1; y--) {
        throwIfStopped(signal)
        for (let attempt = 0; attempt < 6; attempt++) {
          const block = bot.blockAt(new Vec3(column.x, y, column.z))
          if (!block) throw new Error(`Block data is unavailable at ${column.x}, ${y}, ${column.z}. Wait for the area to load and restart the job.`)
          if (airNames.has(block.name)) break
          if (fluidNames.has(block.name)) {
            onLog(`Water or lava at ${column.x}, ${y}, ${column.z} was left untouched.`)
            break
          }

          const gravityBlock = fallingBlockNames.has(block.name) || block.name.endsWith('_concrete_powder')
          try {
            await bot.dig(block, true)
            await bot.waitForTicks(gravityBlock ? 5 : 2)
          } catch (error) {
            const remaining = bot.blockAt(new Vec3(column.x, y, column.z))
            if (!remaining || airNames.has(remaining.name)) break
            if (gravityBlock || remaining.name !== block.name) {
              await bot.waitForTicks(4)
              continue
            }
            if (attempt < 5) {
              onLog('Mining was interrupted. Returning to the last safe route tile and retrying.')
              await goto(bot, new GoalBlock(currentPosition.x, currentPosition.y, currentPosition.z), signal, onLog)
              await bot.waitForTicks(2)
              continue
            }
            throw new Error(`Could not dig ${remaining.name} at ${column.x}, ${y}, ${column.z}: ${error.message}`)
          }

          const remaining = bot.blockAt(new Vec3(column.x, y, column.z))
          if (!remaining) throw new Error(`Block data was lost at ${column.x}, ${y}, ${column.z}.`)
          if (airNames.has(remaining.name)) break
          if (attempt === 5) throw new Error(`Blocks kept falling into ${column.x}, ${y}, ${column.z}; clear that column and restart the job.`)
        }
      }

      ensureRouteSupport(bot, column.x, job.y1, column.z, onLog)
      await goto(bot, new GoalBlock(column.x, job.y1, column.z), signal, onLog)
      currentPosition = { x: column.x, y: job.y1, z: column.z }
      completedColumns++
      if (completedColumns === totalColumns || completedColumns % 4 === 0) {
        onProgress({ completedColumns, totalColumns, minedBlocks: totalMinedBlocks(job, completedColumns), status: 'running' })
      }
    }

    onProgress({ completedColumns, totalColumns, minedBlocks: totalMinedBlocks(job, completedColumns), status: 'completed' })
    onLog('Flat Surface job completed.')
  } finally {
    bot.pathfinder.setGoal(null)
    if (defaultMovements && bot.pathfinder) bot.pathfinder.setMovements(defaultMovements)
    if (previousPvpMovements && bot.pvp) bot.pvp.movements = previousPvpMovements
  }
}

module.exports = { buildSnakeRoute, runFlatSurface, validateFlatSurface }