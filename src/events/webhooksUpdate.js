const { onWebhooksUpdate } = require('../core/antiraid');

module.exports = {
  name: 'webhooksUpdate',
  async execute(channel) {
    await onWebhooksUpdate(channel).catch((error) => console.error('Erreur antiraid (webhooks) :', error));
  },
};
