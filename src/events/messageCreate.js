const { handleMessage } = require('../core/automod');
const { handleCustomCommand } = require('../core/customCommands');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    const blocked = await handleMessage(message).catch((error) => { console.error('Erreur automod :', error); return false; });
    if (blocked) return;
    await handleCustomCommand(message).catch((error) => console.error('Erreur commande custom :', error));
  },
};
