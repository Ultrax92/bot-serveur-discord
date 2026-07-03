const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');
const { sendLeaveMessage } = require('../core/joinleave');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    if (!member.partial) await sendLeaveMessage(member);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: '📤 Membre parti' })
      .setThumbnail(member.user?.displayAvatarURL() ?? null)
      .setDescription(`${member.user?.tag ?? 'Inconnu'} (\`${member.id}\`)`)
      .addFields({ name: 'Membres', value: `${member.guild.memberCount}`, inline: true })
      .setTimestamp();

    if (!member.partial) {
      if (member.joinedTimestamp) {
        embed.addFields({ name: 'Avait rejoint', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
      }
      const roles = member.roles.cache.filter((r) => r.id !== member.guild.roles.everyone.id);
      if (roles.size) {
        embed.addFields({ name: 'Rôles', value: roles.map((r) => `${r}`).join(' ').slice(0, 1024) });
      }
    }

    await sendLog(member.guild, 'leave', embed);
  },
};
