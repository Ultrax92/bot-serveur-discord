const { MessageFlags } = require('discord.js');
const { isModuleEnabled, MODULES } = require('../core/settings');
const { isBotAdmin, canManageAdmins } = require('../core/permissions');
const { handleSetupComponent } = require('../core/setupPanel');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // Clics sur le panneau /setup (boutons et menus)
    if ((interaction.isButton() || interaction.isAnySelectMenu()) && interaction.customId.startsWith('setup:')) {
      if (!interaction.inGuild()) return;
      if (!canManageAdmins(interaction)) {
        return interaction.reply({ content: 'Seul le propriétaire peut utiliser ce panneau.', flags: MessageFlags.Ephemeral });
      }
      try {
        await handleSetupComponent(interaction);
      } catch (error) {
        console.error('Erreur sur le panneau setup :', error);
        await interaction.followUp({ content: 'Une erreur est survenue.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Les commandes ne sont utilisables que sur un serveur.', flags: MessageFlags.Ephemeral });
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    // Le bot est réservé aux admins : owner (.env), propriétaire du serveur, ou ajoutés via /get-admin
    if (!isBotAdmin(interaction)) {
      return interaction.reply({
        content: 'Tu n\'as pas accès aux commandes de ce bot. Seuls les admins du bot peuvent les utiliser.',
        flags: MessageFlags.Ephemeral,
      });
    }

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
