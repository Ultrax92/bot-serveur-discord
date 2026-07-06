const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');
const { handleVoiceState } = require('../core/tempvoc');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    await handleVoiceState(oldState, newState).catch((error) => console.error('Erreur tempvoc :', error));

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    if (oldState.channelId === newState.channelId) return; // mute/deafen : pas loggé

    const embed = new EmbedBuilder().setAuthor(userAuthor(member.user)).setTimestamp();

    if (!oldState.channelId) {
      embed.setColor(0x57f287).setDescription(`🔊 **A rejoint le vocal** ${newState.channel}\n${idLine(member)}`);
    } else if (!newState.channelId) {
      embed.setColor(0xed4245).setDescription(`🔇 **A quitté le vocal** ${oldState.channel}\n${idLine(member)}`);
    } else {
      embed
        .setColor(0xfaa61a)
        .setDescription(`🔀 **Passé de** ${oldState.channel} **à** ${newState.channel}\n${idLine(member)}`);
    }

    await sendLog(member.guild, 'voice', embed);
  },
};
