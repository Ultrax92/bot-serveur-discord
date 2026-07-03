const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    if (oldMember.partial) return;

    // Boost du serveur
    if (!oldMember.premiumSince && newMember.premiumSince) {
      const embed = new EmbedBuilder()
        .setColor(0xf47fff)
        .setAuthor(userAuthor(newMember.user))
        .setDescription(`🚀 **A boosté le serveur !** Merci 💜\n${idLine(newMember)}`)
        .setTimestamp();
      await sendLog(newMember.guild, 'boost', embed);
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
      const embed = new EmbedBuilder()
        .setColor(0x99aab5)
        .setAuthor(userAuthor(newMember.user))
        .setDescription(`🚀 **Ne booste plus le serveur**\n${idLine(newMember)}`)
        .setTimestamp();
      await sendLog(newMember.guild, 'boost', embed);
    }

    // Rôles ajoutés / retirés
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size || removed.size) {
      const lines = ['🎭 **Rôles modifiés**', idLine(newMember)];
      if (added.size) lines.push(`**Ajoutés :** ${added.map((r) => `${r}`).join(' ').slice(0, 900)}`);
      if (removed.size) lines.push(`**Retirés :** ${removed.map((r) => `${r}`).join(' ').slice(0, 900)}`);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor(userAuthor(newMember.user))
        .setDescription(lines.join('\n'))
        .setTimestamp();
      await sendLog(newMember.guild, 'role', embed);
    }
  },
};
