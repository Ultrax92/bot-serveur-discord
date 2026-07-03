# Bot Serveur Discord

Bot Serveur Discord . Slash commands, modules activables par serveur, stockage SQLite (aucun service externe requis).

## Modules

| Module | Statut | Contenu |
|---|---|---|
| 🔨 Modération | ✅ Fait | warn, mute/unmute (timeout), kick, ban/tempban, unban, clear, sanctions, lock, hide, role add/remove/derank, nick |
| ⚙️ Config | ✅ Fait | `/config module` (activer/désactiver), `/config view`, `/config couleur`, `/help` |
| 🧰 Utilitaire | 🔶 Partiel | serverinfo, userinfo, pic — reste : banlist, boosters, rolemembers, snipe, emoji |
| 📜 Logs | ⬜ À faire | modlog, messagelog, voicelog, rolelog, boostlog + autoconfiglog |
| 🤖 Auto-modération | ⬜ À faire | antispam, antilink, antimassmention, badwords, strikes/punitions auto |
| 🛡️ Antiraid | ⬜ À faire | antibot, antitoken, antichannel, antirole, antiwebhook, whitelist, punitions |
| 👋 Arrivées/Départs | ⬜ À faire | messages bienvenue/départ, autorole |
| 🎫 Tickets | ⬜ À faire | panneau avec bouton, claim, rename, close, transcript |
| 🎉 Giveaways | ⬜ À faire | création avec bouton, end, reroll, choose |
| 🔊 Vocaux temporaires | ⬜ À faire | salon générateur, panneau de contrôle |
| 🎭 Rolemenu/Embeds | ⬜ À faire | menus de rôles, générateur d'embed |
| 💾 Backups | ⬜ À faire | backup/restore serveur et émojis |

## Installation (local ou VPS)

Prérequis : Node.js ≥ 20.

```bash
npm install
cp .env.example .env   # puis remplir DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm run deploy          # enregistre les slash commands
npm start
```

### Créer l'application Discord (une seule fois)

1. https://discord.com/developers/applications → **New Application**
2. Onglet **Bot** → **Reset Token** → copier dans `.env` (`DISCORD_TOKEN`)
3. Onglet **Bot** → activer les 3 **Privileged Gateway Intents** (Presence, Server Members, Message Content)
4. Onglet **General Information** → copier l'**Application ID** dans `.env` (`CLIENT_ID`)
5. Inviter le bot : `https://discord.com/oauth2/authorize?client_id=TON_CLIENT_ID&scope=bot+applications.commands&permissions=8`

## Déploiement sur le VPS

```bash
# Sur le VPS (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

git clone https://github.com/Ultrax92/bot-serveur-discord.git && cd bot-serveur-discord
npm install
nano .env               # remplir le token etc.
npm run deploy
pm2 start src/index.js --name bot-serveur-discord

# Démarrage automatique au reboot du VPS :
pm2 startup             # affiche une commande "sudo env PATH=..." → la recopier et l'exécuter
pm2 save                # enregistre la liste des apps à relancer au boot
```

> ℹ️ `pm2 startup` ne configure rien tout seul : il **génère une commande sudo à copier-coller**.
> Équivalent direct (pm2 installé en global) : `sudo pm2 startup -u $USER --hp $HOME`, puis `pm2 save`.

Mise à jour : `git pull && npm install && npm run deploy && pm2 restart bot-serveur-discord`

## Structure du projet

```
src/
  index.js              # point d'entrée : client, chargement commandes/événements
  core/
    db.js               # SQLite (data/bot.sqlite)
    settings.js         # paramètres par serveur + modules activables
    sanctions.js        # historique des sanctions + expiration des tempbans
    utils.js            # embeds, durées, vérification de hiérarchie
  commands/<module>/    # une commande par fichier, propriété `module` = feature flag
  events/               # événements Discord
scripts/
  deploy-commands.js    # enregistrement des slash commands
data/                   # base SQLite (créée automatiquement, non versionnée)
```
