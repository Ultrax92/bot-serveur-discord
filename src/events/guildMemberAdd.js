const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: '📥 Nouveau membre' })
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(`${member} (\`${member.id}\`)`)
      .addFields(
        { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${accountAgeDays < 7 ? ' ⚠️ compte récent' : ''}`, inline: true },
        { name: 'Membres', value: `${member.guild.memberCount}`, inline: true },
      )
      .setTimestamp();
    await sendLog(member.guild, 'join', embed);
  },
};
