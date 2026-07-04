const { exec, spawn } = require('node:child_process');
const util = require('node:util');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const db = require('./db');

const run = util.promisify(exec);
const projectRoot = path.join(__dirname, '..', '..');

const getKv = db.prepare('SELECT value FROM kv WHERE key = ?');
const setKv = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const delKv = db.prepare('DELETE FROM kv WHERE key = ?');

function git(command) {
  return run(`git ${command}`, { cwd: projectRoot, timeout: 60_000 });
}

// Nombre de commits de retard sur origin, et leur liste
async function checkForUpdates() {
  await git('fetch origin');
  const { stdout: behind } = await git('rev-list HEAD..@{u} --count');
  const count = parseInt(behind.trim(), 10);
  if (!count) {
    const { stdout: current } = await git('log -1 --format="%h %s"');
    return { count: 0, current: current.trim() };
  }
  const { stdout: log } = await git('log HEAD..@{u} --oneline --no-decorate');
  return { count, incoming: log.trim().split('\n').slice(0, 10) };
}

// Pull + dépendances si besoin + deploy des commandes. Retourne un résumé.
async function applyUpdate(onProgress) {
  const { stdout: before } = await git('log -1 --format=%h');
  await git('pull --ff-only');
  const { stdout: after } = await git('log -1 --format=%h');

  const { stdout: changed } = await git(`diff --name-only ${before.trim()} ${after.trim()}`);
  const files = changed.trim().split('\n').filter(Boolean);

  if (files.some((f) => f === 'package.json' || f === 'package-lock.json')) {
    await onProgress('📦 Installation des dépendances…');
    await run('npm install --omit=dev', { cwd: projectRoot, timeout: 300_000 });
  }

  await onProgress('⚙️ Enregistrement des commandes auprès de Discord…');
  await run('npm run deploy', { cwd: projectRoot, timeout: 120_000 });

  return { from: before.trim(), to: after.trim(), files: files.length };
}

// Note laissée avant le redémarrage, lue au réveil pour confirmer la mise à jour
function markPendingUpdate(info) {
  setKv.run('pendingUpdate', JSON.stringify({ ...info, at: Date.now() }));
}

function restartViaPm2() {
  const name = process.env.name ?? 'bot-serveur-discord';
  const child = spawn('pm2', ['restart', name], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();
}

// Appelé au démarrage : si une mise à jour vient d'avoir lieu, confirme dans le salon d'origine
async function notifyIfUpdated(client) {
  const row = getKv.get('pendingUpdate');
  if (!row) return;
  delKv.run('pendingUpdate');

  try {
    const info = JSON.parse(row.value);
    const channel = await client.channels.fetch(info.channelId).catch(() => null);
    if (!channel) return;
    const { stdout: current } = await git('log -1 --format="%h %s"').catch(() => ({ stdout: '' }));
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Le bot a bien été mis à jour !')
      .setDescription([
        `**${info.count}** commit(s) appliqué(s) — \`${info.from}\` → \`${info.to}\``,
        current.trim() ? `**Version actuelle :** ${current.trim()}` : null,
        `⏱️ Redémarrage effectué en ${Math.round((Date.now() - info.at) / 1000)}s`,
      ].filter(Boolean).join('\n'))
      .setTimestamp();
    await channel.send({ content: `<@${info.userId}>`, embeds: [embed] });
  } catch (error) {
    console.error('Erreur lors de la notification de mise à jour :', error);
  }
}

module.exports = { checkForUpdates, applyUpdate, markPendingUpdate, restartViaPm2, notifyIfUpdated };
