const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bot.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sanctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- warn | mute | kick | ban
  reason TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,            -- pour tempban/tempmute, NULL sinon
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sanctions_guild_user ON sanctions (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_expiry ON sanctions (active, expires_at);
`);

module.exports = db;
