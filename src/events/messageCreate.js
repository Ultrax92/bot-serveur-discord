const { handleMessage } = require('../core/automod');
const { handleCustomCommand, handlePendingImage } = require('../core/customCommands');
const { cacheMessageImages } = require('../core/imageCache');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Sauvegarde des images pour pouvoir les montrer dans les logs si suppression
    cacheMessageImages(message).catch(() => {});
    // Un message de l'ouvreur dans son ticket = ticket actif (fermeture auto des inactifs)
    const { trackTicketActivity } = require('../core/tickets');
    try { trackTicketActivity(message); } catch (error) { console.error('Erreur suivi activité ticket :', error); }
    // Image d'avis client en attente (flux du bouton 🖼️ en MP, hors serveur)
    const { handlePendingReviewImage } = require('../core/ticketReviews');
    const reviewImageConsumed = await handlePendingReviewImage(message).catch((error) => { console.error('Erreur image avis :', error); return false; });
    if (reviewImageConsumed) return;
    // Fichier de backup en attente (flux du bouton 📤 Importer de /backup)
    const { handlePendingBackupFile } = require('../core/backups');
    const backupConsumed = await handlePendingBackupFile(message).catch((error) => { console.error('Erreur import backup :', error); return false; });
    if (backupConsumed) return;

    // Upload d'image en attente pour une commande custom (flux du bouton 🖼️)
    const consumed = await handlePendingImage(message).catch((error) => { console.error('Erreur upload image :', error); return false; });
    if (consumed) return;

    const blocked = await handleMessage(message).catch((error) => { console.error('Erreur automod :', error); return false; });
    if (blocked) return;
    await handleCustomCommand(message).catch((error) => console.error('Erreur commande custom :', error));
  },
};
