const { ActivityType } = require('discord.js');
const db = require('./db');

const getStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

// Statut affiché sous le nom du bot (global, persistant). Vide = aucun statut.
function getActivityText() {
  const row = getStmt.get('botActivity');
  return row ? JSON.parse(row.value).text : '/help';
}

function applyActivity(client) {
  if (!client?.user) return;
  const text = getActivityText();
  if (text) client.user.setActivity({ name: text, type: ActivityType.Custom });
  else client.user.setActivity(null);
}

function setActivityText(client, text) {
  setStmt.run('botActivity', JSON.stringify({ text }));
  applyActivity(client);
}

module.exports = { getActivityText, applyActivity, setActivityText };
