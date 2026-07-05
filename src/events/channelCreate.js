const { onChannelCreate } = require('../core/antiraid');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    await Promise.resolve(onChannelCreate(channel)).catch((error) => console.error('Erreur antiraid (channelCreate) :', error));
  },
};
