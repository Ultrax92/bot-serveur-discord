const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    if (oldMember.partial) return;

    // Boost du serveur
    if (!oldMember.premiumSince && newMember.premiumSince) {
      const embed = new EmbedBuilder()
        .setColor(0xf47fff)
        .setAuthor({ name: '🚀 Nouveau boost' })
        .setDescription(`${newMember} vient de booster le serveur ! Merci 💜`)
        .setTimestamp();
      await sendLog(newMember.guild, 'boost', embed);
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
      const embed = new EmbedBuilder()
        .setColor(0x99aab5)
        .setAuthor({ name: '🚀 Fin de boost' })
        .setDescription(`${newMember} ne booste plus le serveur.`)
        .setTimestamp();
      await sendLog(newMember.guild, 'boost', embed);
    }

    // Rôles ajoutés / retirés
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size || removed.size) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: '🎭 Rôles modifiés' })
        .setDescription(`Membre : ${newMember} (\`${newMember.id}\`)`)
        .setTimestamp();
      if (added.size) embed.addFields({ name: 'Ajoutés', value: added.map((r) => `${r}`).join(' ').slice(0, 1024), inline: true });
      if (removed.size) embed.addFields({ name: 'Retirés', value: removed.map((r) => `${r}`).join(' ').slice(0, 1024), inline: true });
      await sendLog(newMember.guild, 'role', embed);
    }
  },
};
