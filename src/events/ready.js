const { ActivityType } = require('discord.js');
const { notifyIfUpdated } = require('../core/updater');
const { initInvites } = require('../core/invites');
const { cleanupTempvoc } = require('../core/tempvoc');
const { startStatsWorker } = require('../core/stats');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Connecté en tant que ${client.user.tag} (${client.guilds.cache.size} serveur(s))`);
    client.user.setActivity({ name: '/help', type: ActivityType.Watching });
    // Confirme la mise à jour dans le salon d'origine si on vient d'être redémarré par /update
    notifyIfUpdated(client).catch((error) => console.error('Erreur notification update :', error));
    initInvites(client).catch((error) => console.error('Erreur init invites :', error));
    cleanupTempvoc(client).catch((error) => console.error('Erreur nettoyage tempvoc :', error));
    startStatsWorker(client);
  },
};
