const { MessageFlags } = require('discord.js');
const { isModuleEnabled, MODULES } = require('../core/settings');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Les commandes ne sont utilisables que sur un serveur.', flags: MessageFlags.Ephemeral });
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    if (!isModuleEnabled(interaction.guildId, command.module)) {
      const label = MODULES[command.module]?.label ?? command.module;
      return interaction.reply({
        content: `Le module **${label}** est désactivé sur ce serveur. Un administrateur peut l'activer avec \`/config module\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Erreur sur /${interaction.commandName} :`, error);
      const payload = { content: 'Une erreur est survenue pendant l\'exécution de la commande.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
