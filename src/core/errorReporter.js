const util = require('node:util');
const { EmbedBuilder } = require('discord.js');
const { getSettings } = require('./settings');
const { sendLog } = require('./logs');

// Remonte les erreurs internes dans le salon 🚨 logs-erreurs : plus besoin de
// fouiller `pm2 logs` pour savoir qu'un module a planté. Les erreurs continuent
// d'être écrites sur la sortie standard (donc visibles dans pm2) dans tous les cas.

// Anti-spam : une même erreur n'est envoyée qu'une fois par minute
const recentErrors = new Map(); // signature → date du dernier envoi
let reporting = false; // évite la boucle si le rapport provoque lui-même une erreur

function formatArg(arg) {
  if (arg instanceof Error) return arg.stack ?? String(arg);
  if (typeof arg === 'string') return arg;
  return util.inspect(arg, { depth: 2 });
}

async function report(client, origin, text) {
  const signature = `${origin}:${text.slice(0, 200)}`;
  const last = recentErrors.get(signature) ?? 0;
  if (Date.now() - last < 60_000) return;
  recentErrors.set(signature, Date.now());
  if (recentErrors.size > 200) recentErrors.clear();

  const embed = new EmbedBuilder()
    .setColor(0x992d22)
    .setDescription([`🚨 **Erreur interne** — ${origin}`, `\`\`\`${text.slice(0, 3500)}\`\`\``].join('\n'))
    .setTimestamp();

  for (const guild of client.guilds.cache.values()) {
    if (!getSettings(guild.id).logsChannels.error) continue;
    await sendLog(guild, 'error', embed);
  }
}

function initErrorReporter(client) {
  const original = console.error;

  // Tous les modules du bot tracent déjà leurs plantages via console.error :
  // on intercepte pour dupliquer le message vers Discord
  console.error = (...args) => {
    original.apply(console, args);
    if (reporting || !client.isReady()) return;
    reporting = true;
    setImmediate(() => {
      report(client, 'console.error', args.map(formatArg).join(' '))
        .catch(() => {})
        .finally(() => {
          reporting = false;
        });
    });
  };

  // Promesse rejetée sans .catch() : signalée sans faire tomber le bot
  process.on('unhandledRejection', (reason) => {
    original.apply(console, ['Promesse rejetée non gérée :', reason]);
    if (!client.isReady()) return;
    report(client, 'unhandledRejection', formatArg(reason)).catch(() => {});
  });

  // Exception fatale : rapport best-effort (3 s max) puis arrêt — pm2 redémarre sur un état sain
  process.on('uncaughtException', (error) => {
    original.apply(console, ['Exception non capturée :', error]);
    const exit = () => process.exit(1);
    if (!client.isReady()) return exit();
    Promise.race([
      report(client, 'uncaughtException — le bot redémarre', formatArg(error)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
      .catch(() => {})
      .finally(exit);
  });
}

module.exports = { initErrorReporter };
