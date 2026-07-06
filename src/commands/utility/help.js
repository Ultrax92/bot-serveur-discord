const { SlashCommandBuilder } = require('discord.js');
const { MODULES, getSettings } = require('../../core/settings');
const { baseEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes disponibles'),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);

    // Regroupe les commandes par module, en n'affichant que les modules actifs
    const byModule = new Map();
    for (const command of interaction.client.commands.values()) {
      const key = command.module ?? 'core';
      if (key !== 'core' && settings.modules[key] !== true) continue;
      if (!byModule.has(key)) byModule.set(key, []);
      byModule.get(key).push(command.data);
    }

    const embed = baseEmbed(interaction)
      .setTitle('📖 Aide')
      .setDescription(
        'Voici les commandes disponibles, regroupées par module.\nToute la configuration se fait via le panneau interactif `/setup`.',
      );

    const coreFirst = ['core', ...Object.keys(MODULES)];
    for (const key of coreFirst) {
      const commands = byModule.get(key);
      if (!commands?.length) continue;
      const meta = key === 'core' ? { label: 'Général', emoji: '⚙️' } : MODULES[key];
      embed.addFields({
        name: `${meta.emoji} ${meta.label}`,
        value: commands.map((c) => `\`/${c.name}\` — ${c.description}`).join('\n'),
      });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
