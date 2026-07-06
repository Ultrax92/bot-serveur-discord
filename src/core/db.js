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

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  type_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER,              -- dernier message de l'ouvreur (fermeture auto des inactifs)
  warned_at INTEGER                      -- avertissement d'inactivité envoyé, fermeture 24 h après
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_user ON tickets (guild_id, user_id, status);

CREATE TABLE IF NOT EXISTS ticket_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  type_id TEXT,
  type_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending (attend le client) | awaiting (attend le staff) | published | rejected
  stars INTEGER,
  comment TEXT,
  auto INTEGER NOT NULL DEFAULT 0,         -- 1 = avis 5⭐ générique publié automatiquement
  dm_channel_id TEXT,                      -- message MP de notation, pour l'éditer ensuite
  dm_message_id TEXT,
  review_channel_id TEXT,                  -- message de validation : salon staff ou MP du owner
  review_message_id TEXT,
  transcript TEXT,                         -- transcript du ticket, joint à la validation puis purgé
  image TEXT,                              -- image d'illustration de l'avis (fichier dans data/images)
  deadline INTEGER,                        -- pending : date de l'avis auto (J+7)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_reviews_pending ON ticket_reviews (status, deadline);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  prize TEXT NOT NULL,
  winners INTEGER NOT NULL DEFAULT 1,
  host_id TEXT NOT NULL,
  required_role TEXT,
  ends_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  participants TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways (ended, ends_at);

CREATE TABLE IF NOT EXISTS tempvoc_channels (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manuel',   -- manuel | auto | pré-restauration
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_guild ON backups (guild_id, created_at);

CREATE TABLE IF NOT EXISTS invite_joins (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  inviter_id TEXT,
  code TEXT,
  fake INTEGER NOT NULL DEFAULT 0,
  has_left INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins (guild_id, inviter_id);
`);

// Colonnes ajoutées après coup (ALTER silencieux si la colonne existe déjà)
try { db.exec('ALTER TABLE ticket_reviews ADD COLUMN review_channel_id TEXT'); } catch { /* déjà présente */ }
try { db.exec('ALTER TABLE ticket_reviews ADD COLUMN transcript TEXT'); } catch { /* déjà présente */ }
try { db.exec('ALTER TABLE ticket_reviews ADD COLUMN image TEXT'); } catch { /* déjà présente */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN last_activity_at INTEGER'); } catch { /* déjà présente */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN warned_at INTEGER'); } catch { /* déjà présente */ }

module.exports = db;
