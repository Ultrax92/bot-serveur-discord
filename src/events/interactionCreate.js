const { MessageFlags, EmbedBuilder } = require('discord.js');
const { isModuleEnabled, MODULES } = require('../core/settings');
const { isBotAdmin, canManageAdmins } = require('../core/permissions');
const { handleSetupComponent } = require('../core/setupPanel');
const { sendLog } = require('../core/logs');

const COMMAND_LOG_STYLES = {
  ok: { color: 0x57f287, label: '✅ Commande exécutée' },
  denied: { color: 0xed4245, label: '⛔ Tentative refusée — pas admin du bot' },
  module: { color: 0xfaa61a, label: '🚫 Commande bloquée — module désactivé' },
  error: { color: 0x992d22, label: '💥 Commande en erreur' },
};

// Trace toute utilisation d'une commande, y compris les tentatives refusées
function logCommand(interaction, status) {
  const style = COMMAND_LOG_STYLES[status];
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: style.label })
    .addFields(
      { name: 'Utilisateur', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
      { name: 'Salon', value: `${interaction.channel}`, inline: true },
      { name: 'Commande', value: `\`${interaction.toString().slice(0, 1000)}\`` },
    )
    .setTimestamp();
  sendLog(interaction.guild, 'command', embed).catch(() => {});
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // Interactions du panneau /setup (boutons, menus et formulaires)
    if ((interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit())
      && interaction.customId.startsWith('setup:')) {
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

    // Le bot est réservé aux admins : owner (.env), propriétaire du serveur, ou ajoutés via le panneau
    if (!isBotAdmin(interaction)) {
      logCommand(interaction, 'denied');
      return interaction.reply({
        content: 'Tu n\'as pas accès aux commandes de ce bot. Seuls les admins du bot peuvent les utiliser.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!isModuleEnabled(interaction.guildId, command.module)) {
      const label = MODULES[command.module]?.label ?? command.module;
      logCommand(interaction, 'module');
      return interaction.reply({
        content: `Le module **${label}** est désactivé sur ce serveur. Le propriétaire peut l'activer via \`/setup\` → 🧩 Modules.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await command.execute(interaction);
      logCommand(interaction, 'ok');
    } catch (error) {
      console.error(`Erreur sur /${interaction.commandName} :`, error);
      logCommand(interaction, 'error');
      const payload = { content: 'Une erreur est survenue pendant l\'exécution de la commande.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
