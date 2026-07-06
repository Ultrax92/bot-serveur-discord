// Enregistre les slash commands auprès de Discord, sur TOUS les serveurs où le
// bot est présent (l'enregistrement par serveur est instantané, contrairement au
// global qui peut prendre 1h). À relancer à chaque ajout/modification : npm run deploy
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
    const guilds = await rest.get(Routes.userGuilds());
    console.log(`Enregistrement de ${commands.length} commandes sur ${guilds.length} serveur(s)…`);
    for (const guild of guilds) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), { body: commands });
      console.log(`✅ ${guild.name} (${guild.id})`);
    }
  } catch (error) {
    console.error("Erreur lors de l'enregistrement :", error);
    process.exitCode = 1;
  }
})();
