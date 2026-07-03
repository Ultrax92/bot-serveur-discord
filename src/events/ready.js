const { ActivityType } = require('discord.js');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Connecté en tant que ${client.user.tag} (${client.guilds.cache.size} serveur(s))`);
    client.user.setActivity({ name: '/help', type: ActivityType.Watching });
  },
};
