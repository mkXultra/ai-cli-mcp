const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

function syncServerJson(serverJsonPath, version) {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('nextRelease.version is required to sync server.json');
  }

  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  serverJson.version = version;

  if (!Array.isArray(serverJson.packages)) {
    throw new Error('server.json packages must be an array');
  }

  serverJson.packages = serverJson.packages.map((packageEntry) => ({
    ...packageEntry,
    version,
  }));

  writeFileSync(serverJsonPath, `${JSON.stringify(serverJson, null, 2)}\n`);
}

async function prepare(pluginConfig, context) {
  const cwd = context.cwd || process.cwd();
  syncServerJson(join(cwd, 'server.json'), context.nextRelease.version);
}

module.exports = {
  prepare,
  syncServerJson,
};
