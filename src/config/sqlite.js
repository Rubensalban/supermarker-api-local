const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'queue.sqlite');
const db = new Database(dbPath);

// WAL peut échouer sur certains volumes externes — fallback sur DELETE
try {
  db.pragma('journal_mode = WAL');
} catch {
  db.pragma('journal_mode = DELETE');
}
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    operation TEXT NOT NULL,
    sage_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
  CREATE INDEX IF NOT EXISTS idx_queue_sage_id ON sync_queue(sage_id, entity_type);

  CREATE TABLE IF NOT EXISTS sync_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL UNIQUE,
    last_sync_at TEXT,
    last_full_sync_at TEXT,
    last_sync_status TEXT,
    records_synced INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_alert_level ON alert_history(level);
  CREATE INDEX IF NOT EXISTS idx_alert_created ON alert_history(created_at);
`);

const entities = ['client', 'article', 'facture', 'reglement', 'reglement_imputation'];
const upsertMeta = db.prepare(`
  INSERT OR IGNORE INTO sync_metadata (entity_type) VALUES (?)
`);
for (const entity of entities) {
  upsertMeta.run(entity);
}

module.exports = db;
