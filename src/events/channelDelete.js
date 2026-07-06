const { onChannelDelete } = require('../core/antiraid');

module.exports = {
  name: 'channelDelete',
  async execute(channel) {
    await Promise.resolve(onChannelDelete(channel)).catch((error) =>
      console.error('Erreur antiraid (channelDelete) :', error),
    );
  },
};
