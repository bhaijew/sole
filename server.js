const path = require('path');
process.chdir(__dirname);

const { initDatabase } = require('./dist/db');
const { startServer } = require('./dist/server');
const { startKdsServer } = require('./dist/kds-server');

async function main() {
  try {
    console.log('[FloServer] Initializing SQLite database...');
    initDatabase();

    console.log('[FloServer] Starting API & Frontend server on port 3001...');
    await startServer();

    try {
      console.log('[FloServer] Starting KDS server on port 3002...');
      await startKdsServer();
    } catch (kdsErr) {
      console.warn('[FloServer] KDS warning:', kdsErr.message);
    }

    console.log('[FloServer] Flo POS system is ready on http://localhost:3001');
  } catch (err) {
    console.error('[FloServer] Fatal startup error:', err);
    process.exit(1);
  }
}

main();