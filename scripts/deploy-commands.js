// Enregistre les slash commands auprès de Discord.
// À relancer à chaque ajout/modification de commande : npm run deploy
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsDir = path.join(__dirname, '..', 'src', 'commands');
for (const category of fs.readdirSync(commandsDir)) {
  const categoryDir = path.join(commandsDir, category);
  for (const file of fs.readdirSync(categoryDir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(categoryDir, file));
    if (command.data) commands.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Enregistrement de ${commands.length} commandes…`);
    if (process.env.GUILD_ID) {
      // Enregistrement sur un seul serveur : instantané, idéal pour tester
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
      console.log(`✅ Commandes enregistrées sur le serveur ${process.env.GUILD_ID}.`);
    } else {
      // Enregistrement global : peut prendre jusqu'à 1h pour se propager
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('✅ Commandes enregistrées globalement.');
    }
  } catch (error) {
    console.error("Erreur lors de l'enregistrement :", error);
    process.exitCode = 1;
  }
})();
