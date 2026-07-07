const db = require('./db');

// Détecte les redémarrages inattendus (crash, OOM, kill) et prévient le owner
// en MP. Principe : un battement de cœur écrit en base chaque minute + un
// drapeau « arrêt propre » posé sur SIGINT/SIGTERM (pm2 stop/restart, /update).
// Au démarrage : ni mise à jour en cours, ni arrêt propre, mais un battement
// présent → le processus est mort sans prévenir, donc crash probable.

const getKv = db.prepare('SELECT value FROM kv WHERE key = ?');
const setKv = db.prepare(
  'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
const delKv = db.prepare('DELETE FROM kv WHERE key = ?');

const HEARTBEAT_INTERVAL_MS = 60_000;

async function notifyOwner(client, lastBeat) {
  if (!process.env.OWNER_ID) return;
  const owner = await client.users.fetch(process.env.OWNER_ID).catch(() => null);
  if (!owner) return;
  await owner
    .send(
      [
        '💓 **Redémarrage inattendu détecté** — le bot vient de redémarrer sans passer par `/update` ni par un arrêt volontaire (crash probable).',
        lastBeat ? `Dernier signe de vie : <t:${Math.floor(lastBeat / 1000)}:R>.` : null,
        'Regarde le salon 🚨 logs-erreurs ou `pm2 logs bot-serveur-discord` pour la cause.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .catch(() => {});
}

function initCrashNotify(client) {
  // pm2 stop/restart (et donc /update) envoient SIGINT/SIGTERM : arrêt volontaire
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try {
        setKv.run('cleanShutdown', '1');
      } catch {
        /* base indisponible : tant pis, fausse alerte possible */
      }
      process.exit(0);
    });
  }

  // Analyse du démarrage courant (avant que l'updater ne consomme son drapeau)
  const wasUpdate = Boolean(getKv.get('pendingUpdate'));
  const wasClean = Boolean(getKv.get('cleanShutdown'));
  const lastBeat = Number(getKv.get('lastHeartbeat')?.value) || null;
  delKv.run('cleanShutdown');
  if (!wasUpdate && !wasClean && lastBeat) {
    notifyOwner(client, lastBeat).catch(() => {});
  }

  setKv.run('lastHeartbeat', String(Date.now()));
  setInterval(() => {
    try {
      setKv.run('lastHeartbeat', String(Date.now()));
    } catch {
      /* battement raté, le suivant rattrapera */
    }
  }, HEARTBEAT_INTERVAL_MS);
}

module.exports = { initCrashNotify };
