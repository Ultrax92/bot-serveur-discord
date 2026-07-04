const { handleMessage } = require('../core/automod');
const { handleCustomCommand, handlePendingImage } = require('../core/customCommands');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Upload d'image en attente pour une commande custom (flux du bouton 🖼️)
    const consumed = await handlePendingImage(message).catch((error) => { console.error('Erreur upload image :', error); return false; });
    if (consumed) return;

    const blocked = await handleMessage(message).catch((error) => { console.error('Erreur automod :', error); return false; });
    if (blocked) return;
    await handleCustomCommand(message).catch((error) => console.error('Erreur commande custom :', error));
  },
};
