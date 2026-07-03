const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { MODULES, getSettings, updateSettings } = require('../../core/settings');
const { baseEmbed, successEmbed } = require('../../core/utils');

const moduleChoices = Object.entries(MODULES).map(([value, m]) => ({ name: m.label, value }));

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure le bot sur ce serveur')
    .addSubcommand((sub) =>
      sub
        .setName('module')
        .setDescription('Active ou désactive un module')
        .addStringOption((opt) =>
          opt.setName('module').setDescription('Le module à configurer').setRequired(true).addChoices(...moduleChoices))
        .addBooleanOption((opt) =>
          opt.setName('actif').setDescription('Activer (true) ou désactiver (false)').setRequired(true)))
    .addSubcommand((sub) => sub.setName('view').setDescription('Affiche la configuration actuelle'))
    .addSubcommand((sub) =>
      sub
        .setName('couleur')
        .setDescription('Change la couleur des embeds du bot')
        .addStringOption((opt) =>
          opt.setName('hex').setDescription('Couleur au format hexadécimal, ex: #5865F2').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'module') {
      const moduleName = interaction.options.getString('module');
      const enabled = interaction.options.getBoolean('actif');
      updateSettings(interaction.guildId, (s) => { s.modules[moduleName] = enabled; });
      const { label, emoji } = MODULES[moduleName];
      return interaction.reply({
        embeds: [successEmbed(interaction.guildId, `Module ${emoji} **${label}** ${enabled ? 'activé' : 'désactivé'}.`)],
      });
    }

    if (sub === 'view') {
      const settings = getSettings(interaction.guildId);
      const lines = Object.entries(MODULES).map(([key, m]) =>
        `${settings.modules[key] ? '🟢' : '🔴'} ${m.emoji} **${m.label}** — ${m.description}`);
      const admins = settings.admins.length ? settings.admins.map((id) => `<@${id}>`).join(', ') : 'Aucun (owner uniquement)';
      const embed = baseEmbed(interaction.guildId)
        .setTitle(`Configuration de ${interaction.guild.name}`)
        .setDescription(lines.join('\n'))
        .addFields({ name: '👑 Admins du bot', value: admins })
        .setFooter({ text: 'Utilise /config module pour activer ou désactiver un module' });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'couleur') {
      const hex = interaction.options.getString('hex').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(hex)) {
        return interaction.reply({ content: 'Format invalide. Exemple attendu : `#5865F2`', flags: MessageFlags.Ephemeral });
      }
      updateSettings(interaction.guildId, (s) => { s.color = parseInt(hex, 16); });
      return interaction.reply({ embeds: [successEmbed(interaction.guildId, `Couleur des embeds changée en \`#${hex.toUpperCase()}\`.`)] });
    }
  },
};
