const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor(userAuthor(member.user))
      .setDescription([
        `📥 **A rejoint le serveur** — ${member.guild.memberCount}ᵉ membre`,
        idLine(member),
        `**Compte créé** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${accountAgeDays < 7 ? ' ⚠️ **compte récent**' : ''}`,
      ].join('\n'))
      .setTimestamp();
    await sendLog(member.guild, 'join', embed);
  },
};
