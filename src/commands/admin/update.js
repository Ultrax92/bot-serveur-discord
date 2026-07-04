const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isOwner } = require('../../core/permissions');
const { checkForUpdates, applyUpdate, markPendingUpdate, restartViaPm2 } = require('../../core/updater');
const { errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('[Owner] Met à jour le bot depuis GitHub et le redémarre'),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Seul le owner du bot (OWNER_ID) peut lancer une mise à jour.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const progress = (description) => interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle('🔄 Mise à jour du bot en cours…').setDescription(description).setTimestamp()],
    });

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle('🔄 Mise à jour du bot').setDescription('🔍 Vérification des mises à jour disponibles…').setTimestamp()],
    });

    let check;
    try {
      check = await checkForUpdates();
    } catch (error) {
      console.error('Erreur update (check) :', error);
      return interaction.editReply({ embeds: [errorEmbed(interaction, `Impossible de vérifier les mises à jour :\n\`\`\`${String(error.message).slice(0, 500)}\`\`\``)] });
    }

    if (check.count === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Déjà à jour')
        .setDescription(`Le bot est sur la dernière version.\n**Version actuelle :** ${check.current}`)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    await progress([
      `📥 **${check.count}** commit(s) à appliquer :`,
      '```',
      check.incoming.join('\n').slice(0, 1500),
      '```',
      '⏳ Téléchargement en cours…',
    ].join('\n'));

    let result;
    try {
      result = await applyUpdate(progress);
    } catch (error) {
      console.error('Erreur update (apply) :', error);
      return interaction.editReply({
        embeds: [errorEmbed(interaction, `La mise à jour a échoué :\n\`\`\`${String(error.message).slice(0, 800)}\`\`\`\nVérifie sur le VPS (\`git status\`), il y a peut-être des modifications locales en conflit.`)],
      });
    }

    // Note pour se confirmer soi-même après le redémarrage
    markPendingUpdate({
      channelId: interaction.channelId,
      userId: interaction.user.id,
      count: check.count,
      from: result.from,
      to: result.to,
    });

    await progress(`♻️ **${check.count}** commit(s) appliqué(s) (\`${result.from}\` → \`${result.to}\`, ${result.files} fichier(s)).\nRedémarrage du bot… je confirme ici dès que je suis de retour.`);
    restartViaPm2();
  },
};
