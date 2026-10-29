const config = require('config');
const { readdirSync, realpathSync, rmSync, statSync } = require('fs-extra');
const { tmpdir } = require('os');
const { join } = require('path');

const log = require('./src/components/log')(module.filename);

const RATIO = 0.7; // Best practice is to keep the cache no more than 70% full

const osTempDir = realpathSync(tmpdir());
const cacheDir = (() => {
  if (config.has('carbone.cacheDir')) {
    return realpathSync(config.get('carbone.cacheDir'));
  } else {
    return osTempDir;
  }
})();

const cacheSize = (() => {
  const parseRegex = /^(\d+(?:\.\d+)?) *([kmgtp]?b)$/i;
  const unitMap = {
    b: Math.pow(10, 0),
    kb: Math.pow(10, 3),
    mb: Math.pow(10, 6),
    gb: Math.pow(10, 9),
    tb: Math.pow(10, 12),
    pb: Math.pow(10, 15)
  };

  if (config.has('carbone.cacheSize')) {
    const result = parseRegex.exec(config.get('carbone.cacheSize'));
    if (result && Array.isArray(result)) {
      return parseInt(result[1]) * unitMap[result[2].toLowerCase()];
    }
  } else {
    return null;
  }
})();
const cacheSizeLimit = Math.ceil(cacheSize * RATIO);

log.info(`Cache directory ${cacheDir} with max size of ${cacheSizeLimit}`);

// Short circuit exits
if (!cacheSize) {
  log.info('Maximum cache size not defined - Exiting');
  process.exit(0);
} else if (cacheDir === osTempDir) {
  log.info('Cache points to OS temp directory - Exiting');
  process.exit(0);
}

// Check cache size and prune oldest files away as needed
try {
  const items = getSortedPaths(cacheDir);
  const currCacheSize = items
    .map(p => p.size)
    .reduce((i, size) => i + size, 0);
  const isWithinLimit = currCacheSize < cacheSizeLimit;
  const status = isWithinLimit ? 'below' : 'above';

  log.info(`Current cache size ${currCacheSize} ${status} threshold of ${cacheSizeLimit}`, {
    cacheLimit: cacheSizeLimit,
    cacheSize: currCacheSize
  });

  // Prune if necessary
  const pruneList = [];
  if (!isWithinLimit) {
    const difference = currCacheSize - cacheSizeLimit;
    let i = 0, pruneSum = 0;

    // Determine list to prune
    while (pruneSum < difference) {
      pruneSum += items[i].size;
      pruneList.push(items[i].name);
      i++;
    }

    for (const obj of pruneList) {
      const path = join(cacheDir, obj);
      rmSync(path, { recursive: true, force: true });
      log.info('Object pruned', { object: obj });
    }
  }

  log.info(`${pruneList.length} objects were pruned from the cache - Exiting`, { pruneCount: pruneList.length });
  process.exit(0);
} catch (err) {
  log.error(err);
  process.exit(1);
}

/**
 * @function pathSize
 * Recursively calculates the size of `path`
 * @param {string} path The path to calculate
 * @returns {number} The size of the path in bytes
 */
function pathSize(path) {
  // The running service adds and removes cache entries concurrently, so a path
  // can disappear between listing and stat-ing it. Treat that as size zero.
  const dirStat = statSyncSafe(path);
  if (!dirStat) return 0;

  if (dirStat.isDirectory()) {
    return readdirSyncSafe(path)
      .flatMap(file => pathSize(join(path, file)))
      .reduce((i, size) => i + size, 0);
  }
  else if (dirStat.isFile()) return dirStat.size;
  else return 0;
}

/**
 * @function statSyncSafe
 * Stats `path`, returning null if it no longer exists
 * @param {string} path The path to stat
 * @returns {object|null} The stat object, or null
 */
function statSyncSafe(path) {
  try {
    return statSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @function readdirSyncSafe
 * Lists `path`, returning an empty list if it no longer exists
 * @param {string} path The path to list
 * @returns {Array<string>} The directory entries
 */
function readdirSyncSafe(path) {
  try {
    return readdirSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * @function getSortedPaths
 * Acquires a list of paths ordered from oldest to newest modified
 * @param {string} path The path to inspect
 * @returns {Array<object>} The list of files and directories in `path`.
 * Each object contains `name`, `size` and `time` attributes.
 */
function getSortedPaths(path) {
  return readdirSyncSafe(path)
    .map(file => {
      const fullDir = join(path, file);
      const stat = statSyncSafe(fullDir);
      if (!stat) return null;

      return {
        name: file,
        size: pathSize(fullDir),
        time: stat.mtime.getTime(),
      };
    })
    .filter(item => item !== null)
    .sort((a, b) => a.time - b.time);
}
