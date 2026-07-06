const { Routes } = require('discord.js');

// Le bot rejoint un nouveau serveur : ses slash commands y sont enregistrées
// immédiatement, sans attendre le prochain npm run deploy
module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    try {
      const commands = guild.client.commands.map((c) => c.data.toJSON());
      await guild.client.rest.put(Routes.applicationGuildCommands(guild.client.application.id, guild.id), {
        body: commands,
      });
      console.log(`[deploy] Commandes enregistrées sur le nouveau serveur ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error(`[deploy] Enregistrement des commandes impossible sur ${guild.id} :`, error);
    }
  },
};
