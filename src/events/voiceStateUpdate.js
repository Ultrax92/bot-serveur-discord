const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    if (oldState.channelId === newState.channelId) return; // mute/deafen : pas loggé

    const embed = new EmbedBuilder().setTimestamp();

    if (!oldState.channelId) {
      embed.setColor(0x57f287).setAuthor({ name: '🔊 Connexion en vocal' })
        .setDescription(`${member} a rejoint ${newState.channel}`);
    } else if (!newState.channelId) {
      embed.setColor(0xed4245).setAuthor({ name: '🔇 Déconnexion du vocal' })
        .setDescription(`${member} a quitté ${oldState.channel}`);
    } else {
      embed.setColor(0xfaa61a).setAuthor({ name: '🔀 Changement de salon vocal' })
        .setDescription(`${member} est passé de ${oldState.channel} à ${newState.channel}`);
    }

    await sendLog(member.guild, 'voice', embed);
  },
};
