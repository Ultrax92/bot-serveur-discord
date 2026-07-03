const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { autoConfigureLogs } = require('../../core/logs');
const { updateSettings, MODULES } = require('../../core/settings');
const { canManageAdmins } = require('../../core/permissions');
const { baseEmbed, errorEmbed } = require('../../core/utils');

// Modules activés par le setup de base (les autres restent à activer manuellement)
const SETUP_MODULES = ['moderation', 'utility', 'logs'];

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure le serveur avec les réglages de base recommandés'),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guildId, 'Seul le propriétaire peut lancer le setup.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    const steps = [];

    // 1. Active les modules recommandés
    updateSettings(interaction.guildId, (s) => {
      for (const moduleName of SETUP_MODULES) s.modules[moduleName] = true;
    });
    steps.push(`✅ Modules activés : ${SETUP_MODULES.map((m) => `${MODULES[m].emoji} **${MODULES[m].label}**`).join(', ')}`);

    // 2. Crée la catégorie et les salons de logs (réutilise l'existant)
    try {
      const created = await autoConfigureLogs(interaction.guild);
      steps.push(created.length
        ? `✅ Salons de logs créés : ${created.join(' ')}`
        : '✅ Salons de logs : déjà configurés');
    } catch (error) {
      steps.push('⚠️ Impossible de créer les salons de logs (vérifie mes permissions "Gérer les salons")');
    }

    // 3. Rappels utiles
    steps.push('', '**Prochaines étapes recommandées :**');
    steps.push('• `/get-admin @membre` pour donner accès au bot à tes modérateurs');
    steps.push('• `/config view` pour voir tous les modules disponibles');
    steps.push('• Vérifie que mon rôle est **tout en haut de la hiérarchie** (juste sous le owner)');

    const embed = baseEmbed(interaction.guildId)
      .setTitle(`🛠️ Setup de ${interaction.guild.name} terminé`)
      .setDescription(steps.join('\n'));
    return interaction.editReply({ embeds: [embed] });
  },
};
