const db = require('./db');

// Garde d'idempotence des interactions : chaque interaction Discord ne doit être
// traitée qu'une seule fois. En temps normal (une instance) c'est toujours le cas,
// mais si deux instances du bot tournent avec le même token (process zombie après
// un /update mal terminé), Discord délivre CHAQUE interaction aux deux → doublons.
// La réservation passe par la base partagée : la première instance qui insère l'id
// traite, l'autre est ignorée.

const claimStmt = db.prepare('INSERT INTO processed_interactions (id, created_at) VALUES (?, ?)');
const cleanupStmt = db.prepare('DELETE FROM processed_interactions WHERE created_at < ?');

// true si l'interaction n'a jamais été vue (à traiter), false si déjà réservée
function claimInteraction(id) {
  try {
    claimStmt.run(id, Date.now());
    return true;
  } catch {
    return false; // clé dupliquée → déjà traitée par cette instance ou une autre
  }
}

// Purge horaire : les ids de plus de 15 min ne peuvent plus revenir (interactions expirées)
const timer = setInterval(() => {
  try {
    cleanupStmt.run(Date.now() - 15 * 60_000);
  } catch {
    /* réessai au prochain passage */
  }
}, 60 * 60_000);
timer.unref?.();

module.exports = { claimInteraction };
