const { onBanAdd } = require('../core/antiraid');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban) {
    await Promise.resolve(onBanAdd(ban)).catch((error) => console.error('Erreur antiraid (banAdd) :', error));
  },
};
