const { getSettings, isModuleEnabled } = require('./settings');

// Cache mémoire des images vues dans les salons : quand un message est supprimé,
// Discord efface aussi ses pièces jointes du CDN — pour pouvoir montrer le visuel
// dans les logs, il faut l'avoir sauvegardé AVANT la suppression.
const TTL_MS = 60 * 60_000;             // une image reste 1h en cache
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // au-delà de 8 Mo, on ne cache pas
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;  // budget mémoire global
const MAX_ENTRIES = 300;

const cache = new Map(); // attachmentId → { buffer, name, expires }
let totalBytes = 0;

function evict(attachmentId) {
  const entry = cache.get(attachmentId);
  if (!entry) return;
  totalBytes -= entry.buffer.length;
  cache.delete(attachmentId);
}

function sweep(neededBytes) {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (entry.expires < now) evict(id);
  }
  // Budget dépassé : on retire les plus anciennes (ordre d'insertion de la Map)
  for (const id of cache.keys()) {
    if (cache.size < MAX_ENTRIES && totalBytes + neededBytes <= MAX_TOTAL_BYTES) break;
    evict(id);
  }
}

// À chaque message avec image(s) : téléchargement en cache, si les logs de
// messages sont configurés (sinon inutile de consommer de la mémoire)
async function cacheMessageImages(message) {
  if (!message.inGuild() || message.author?.bot) return;
  if (!message.attachments?.size) return;
  if (!isModuleEnabled(message.guildId, 'logs')) return;
  if (!getSettings(message.guildId).logsChannels.message) return;

  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    if (attachment.size > MAX_IMAGE_BYTES || cache.has(attachment.id)) continue;

    const response = await fetch(attachment.url).catch(() => null);
    if (!response?.ok) continue;
    const buffer = Buffer.from(await response.arrayBuffer());

    sweep(buffer.length);
    const ext = (attachment.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    cache.set(attachment.id, {
      buffer,
      name: `img-${attachment.id}.${ext}`,
      expires: Date.now() + TTL_MS,
    });
    totalBytes += buffer.length;
  }
}

// Récupère les images en cache d'un message supprimé (jusqu'à `max`)
function getCachedImages(message, max = 4) {
  const found = [];
  if (!message.attachments?.size) return found;
  for (const attachment of message.attachments.values()) {
    const entry = cache.get(attachment.id);
    if (entry && entry.expires > Date.now()) {
      found.push({ buffer: entry.buffer, name: entry.name });
      if (found.length >= max) break;
    }
  }
  return found;
}

module.exports = { cacheMessageImages, getCachedImages };
