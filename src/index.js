require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { startExpiryWorker } = require('./core/sanctions');
const { startGiveawayWorker } = require('./core/giveaways');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages, // MP : upload d'image pour les avis de tickets
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// Chargement des commandes : src/commands/<categorie>/<commande>.js
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const category of fs.readdirSync(commandsDir)) {
  const categoryDir = path.join(commandsDir, category);
  for (const file of fs.readdirSync(categoryDir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(categoryDir, file));
    if (!command.data || !command.execute) {
      console.warn(`[WARN] Commande invalide ignorée : ${category}/${file}`);
      continue;
    }
    client.commands.set(command.data.name, command);
  }
}
console.log(`${client.commands.size} commandes chargées.`);

// Chargement des événements : src/events/<event>.js
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

client.once('clientReady', () => {
  startExpiryWorker(client);
  startGiveawayWorker(client);
});

client.login(process.env.DISCORD_TOKEN);
