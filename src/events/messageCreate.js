const { handleMessage } = require('../core/automod');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    await handleMessage(message).catch((error) => console.error('Erreur automod :', error));
  },
};
