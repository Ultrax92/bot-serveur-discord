const { MessageFlags, EmbedBuilder } = require('discord.js');
const { isModuleEnabled, MODULES } = require('../core/settings');
const { isBotAdmin, canManageAdmins, isOwner } = require('../core/permissions');
const { handleSetupComponent } = require('../core/setupPanel');
const { handleVerifyButton } = require('../core/verification');
const { handleTicketComponent } = require('../core/tickets');
const { handleGiveawayComponent } = require('../core/giveaways');
const { handleTempvocComponent } = require('../core/tempvoc');
const { sendLog, userAuthor, idLine } = require('../core/logs');

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
    .setAuthor(userAuthor(interaction.user))
    .setDescription(
      [
        `${style.label} **dans** ${interaction.channel}`,
        idLine(interaction.user),
        `\`${interaction.toString().slice(0, 1000)}\``,
      ].join('\n'),
    )
    .setTimestamp();
  sendLog(interaction.guild, 'command', embed).catch(() => {});
}

// Courses bénignes, pas des bugs : salon ou message supprimé sous l'interaction
// (double-clic sur Fermer pendant la suppression du ticket, panneau republié…),
// interaction expirée ou déjà acquittée. Impossible d'y répondre, rien à corriger :
// simple warn, sans remonter dans le salon d'erreurs.
const BENIGN_ERROR_CODES = new Set([
  10003, // Unknown Channel
  10008, // Unknown Message
  10062, // Unknown interaction (token expiré)
  40060, // Interaction déjà acquittée
]);

async function reportComponentError(scope, interaction, error, { followUp = false } = {}) {
  if (BENIGN_ERROR_CODES.has(error?.code)) {
    console.warn(`[interactions] ${scope} : interaction ignorée (${error.code}, salon/message disparu ou expirée).`);
    return;
  }
  console.error(`Erreur sur ${scope} :`, error);
  const payload = { content: 'Une erreur est survenue, réessaie.', flags: MessageFlags.Ephemeral };
  await (followUp ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // Garde anti-doublon : une interaction n'est traitée qu'une fois, même si une
    // seconde instance du bot tourne (Discord la délivrerait alors aux deux)
    const { claimInteraction } = require('../core/interactionLock');
    if (!claimInteraction(interaction.id)) return;

    // Bouton public de vérification (ouvert à tous les membres, pas de gate admin)
    if (interaction.isButton() && interaction.customId === 'verify:go') {
      if (!interaction.inGuild()) return;
      try {
        await handleVerifyButton(interaction);
      } catch (error) {
        await reportComponentError('le bouton de vérification', interaction, error);
      }
      return;
    }

    // Système de tickets (ouvert aux membres : ouverture via sélecteur, claim/close via boutons)
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('ticket:')) {
      if (!interaction.inGuild()) return;
      try {
        await handleTicketComponent(interaction);
      } catch (error) {
        await reportComponentError('le système de tickets', interaction, error);
      }
      return;
    }

    // Notation des tickets : étoiles/commentaire en MP (ouvreur), validation en serveur (staff)
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('rv:')) {
      try {
        const { handleReviewComponent } = require('../core/ticketReviews');
        await handleReviewComponent(interaction);
      } catch (error) {
        await reportComponentError('la notation des tickets', interaction, error);
      }
      return;
    }

    // Giveaways : participation publique, fin/reroll vérifiés côté handler
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('gw:')) {
      if (!interaction.inGuild()) return;
      try {
        await handleGiveawayComponent(interaction);
      } catch (error) {
        await reportComponentError('les giveaways', interaction, error);
      }
      return;
    }

    // Backups des settings (panneau éphémère de /backup, owner uniquement)
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('bk:')) {
      if (!interaction.inGuild() || !canManageAdmins(interaction)) return;
      try {
        const { handleBackupComponent } = require('../core/backups');
        await handleBackupComponent(interaction);
      } catch (error) {
        await reportComponentError('les backups', interaction, error);
      }
      return;
    }

    // Recovery : campagne de rappel des membres (owner ; le bouton ⏹️ vit dans ses MP)
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('rc:')) {
      const allowed = interaction.inGuild() ? canManageAdmins(interaction) : isOwner(interaction.user.id);
      if (!allowed) return;
      try {
        const { handleRecoveryComponent } = require('../core/recovery');
        await handleRecoveryComponent(interaction);
      } catch (error) {
        await reportComponentError('le recovery', interaction, error);
      }
      return;
    }

    // Messages programmés (panneau éphémère de /schedule, admins uniquement)
    if (
      (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith('sch:')
    ) {
      if (!interaction.inGuild() || !isBotAdmin(interaction)) return;
      try {
        const { handleScheduleComponent } = require('../core/scheduler');
        await handleScheduleComponent(interaction);
      } catch (error) {
        await reportComponentError('les messages programmés', interaction, error);
      }
      return;
    }

    // Générateur d'embeds (panneau éphémère de /embed, admins uniquement)
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('eb:')) {
      if (!interaction.inGuild() || !isBotAdmin(interaction)) return;
      try {
        const { handleEmbedComponent } = require('../core/embedBuilder');
        await handleEmbedComponent(interaction);
      } catch (error) {
        await reportComponentError("le générateur d'embeds", interaction, error);
      }
      return;
    }

    // Vocaux temporaires : panneau de contrôle du salon (propriétaire vérifié côté handler)
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('tv:')) {
      if (!interaction.inGuild()) return;
      try {
        await handleTempvocComponent(interaction);
      } catch (error) {
        await reportComponentError('les vocaux temporaires', interaction, error);
      }
      return;
    }

    // Interactions du panneau /setup (boutons, menus et formulaires)
    if (
      (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith('setup:')
    ) {
      if (!interaction.inGuild()) return;
      if (!canManageAdmins(interaction)) {
        return interaction.reply({
          content: 'Seul le propriétaire peut utiliser ce panneau.',
          flags: MessageFlags.Ephemeral,
        });
      }
      try {
        await handleSetupComponent(interaction);
      } catch (error) {
        await reportComponentError('le panneau setup', interaction, error, { followUp: true });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Les commandes ne sont utilisables que sur un serveur.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    // Le bot est réservé aux admins : owner (.env), propriétaire du serveur, ou ajoutés via le panneau.
    // Exception : les commandes marquées public (ex: /close et /add dans un ticket) font leurs propres vérifications.
    if (!command.public && !isBotAdmin(interaction)) {
      logCommand(interaction, 'denied');
      return interaction.reply({
        content: "Tu n'as pas accès aux commandes de ce bot. Seuls les admins du bot peuvent les utiliser.",
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
      const payload = {
        content: "Une erreur est survenue pendant l'exécution de la commande.",
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
