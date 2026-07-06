# Bot Serveur Discord

Bot Serveur Discord . Slash commands, modules activables par serveur, stockage SQLite (aucun service externe requis).

## Modules

| Module | Statut | Contenu |
|---|---|---|
| 🔨 Modération | ✅ Fait | warn, mute/unmute (timeout), kick, ban/tempban, unban, clear, clean-channel (purge complète en arrière-plan, owner), sanctions, lock, hide, role — les commandes à variantes utilisent une option "action" à choix plutôt que des sous-commandes ; sanctions par paliers (`/setup` → 🔨) : X warns en Z jours → mute auto (durée réglable), Y warns → ban définitif — warns manuels + automod, fenêtre glissante, owner/admins exemptés, sanctions inscrites au casier |
| ⚙️ Config | ✅ Fait | `/setup` : panneau interactif unique (modules, admins du bot, couleur, réglages modération, salons de logs) + `/help` |
| 🧰 Utilitaire | 🔶 Partiel | serverinfo, userinfo — reste : banlist, boosters, rolemembers, snipe, emoji |
| 📜 Logs | ✅ Fait | configuré via `/setup` → 📜 (salon existant, création en un clic, saisie par ID, ou désactivé, par type) — modération, messages supprimés/édités, vocal, rôles, boosts, arrivées, départs, commandes du bot (exécutées, refusées, bloquées, en erreur), erreurs internes du bot (🚨 logs-erreurs : plantages de modules, promesses rejetées, crash — dédoublonnées 1 min, avec redémarrage propre via pm2 en cas d'exception fatale) + salons vérif/tickets/raid (alimentés quand leurs modules arriveront) |
| 🤖 Auto-modération | ✅ Fait | configuré via `/setup` → 🤖 : antispam (seuil réglable), antilink (invitations ou tous liens), antimention, mots interdits — suppression + sanction auto configurable (aucune/warn/mute), admins du bot exemptés |
| 🛡️ Antiraid | ✅ Fait | configuré via `/setup` → 🛡️ : antibot, rafales de salons/rôles/bans (seuils réglables), antiwebhook, détection de vague d'arrivées (alerte par défaut — pensée pour ne pas gêner les services de boost), whitelist, punition derank/kick/ban, logs-raid |
| ✅ Vérification | ✅ Fait | configuré via `/setup` → ✅ : salon + rôle + message, panneau publié avec bouton persistant "Se vérifier", rôle attribué au clic, logs dans le salon vérif |
| 🧩 Commandes custom | ✅ Fait | `/custom` (ou `/setup` → 🧩) : commandes à préfixe (`+regles`, `!boutique`…) créées via panneau — préfixe + ! . ? -, rôles autorisés, suppression auto du déclencheur, réponse texte ou embed (titre, message, image) avec variables |
| 🎫 Tickets | ✅ Fait | configuré via `/setup` → 🎫 : types créés/modifiés/supprimés librement (catégorie, rôles mentionnés/accès, message d'ouverture chacun), panneau à sélecteur publié, salons numérotés (0001…), claim/close (boutons + `/ticket action:[ajouter/retirer/claim/fermer] [membre] [ticket par ID/lien, vide = ticket courant]`), max par personne, rôle requis, fermeture au départ du membre, fermeture auto des tickets inactifs après X jours (seuls les messages de l'ouvreur comptent, avertissement avec mention 24 h avant), transcript complet .txt en MP + logs-tickets, automod inactif dans les tickets, notation des avis clients (`/setup` → 🎫 → ⭐) : MP à la fermeture (note 1-5⭐, commentaire et image uploadée facultatifs, envoi par 📤), 5⭐ sans contenu publié direct, sinon validation staff avec transcript joint (salon dédié ou MP owner), avis 5⭐ générique auto à J+7 sans envoi ou si le membre est parti, rôle client à la publication |
| 🎉 Giveaways | ✅ Fait | `/giveaway` (formulaire lot/durée/gagnants) publié dans le salon courant, participation par bouton 🎉 (retrait en re-cliquant), rôle requis configurable via `/setup` → 🎉, tirage auto à échéance (survit aux redémarrages), fin anticipée ⏹️ et reroll 🔁 sur le message |
| 🔊 Vocaux temporaires | ✅ Fait | configuré via `/setup` → 🔊 : salon générateur (existant ou créé), rejoindre = salon perso + panneau de contrôle dans le chat du vocal (renommer, verrouiller, limite), supprimé quand vide — remplace ChannelManager |
| 📨 Invite tracker | ✅ Fait | qui a invité qui dans logs-join, décompte mis à jour dans logs-leave au départ d'un invité, `/invites`, `/leaderboard`, détection comptes récents — remplace Invite Tracker |
| 📊 Stats serveur | ✅ Fait | configuré via `/setup` → 📊 : compteurs Membres + par rôle en salons vocaux verrouillés (connexion et chat bloqués), actualisés toutes les 10 min — remplace ServerStats |
| 🎨 Générateur d'embeds | ✅ Fait | `/embed [salon] [mp]` : panneau éphémère = aperçu en direct — titre/description/couleur, image (URL ou upload stocké), boutons-liens, import d'un embed existant par lien de message, envoi dans un salon ou en MP |
| 🎭 Rolemenu | ⬜ En attente | menus de rôles self-service (utilité à confirmer vu la vérification) |
| 💾 Backups | ✅ Fait | `/backup` (owner) : snapshots de toute la config du bot en base (15 max, auto quotidien 4h30), téléchargement en `.json` local, import du fichier avec confirmation, backup pré-restauration automatique, export auto en MP au owner (hebdo lundi ou quotidien, sans images si trop volumineux) |

## Système de permissions

Le bot est **réservé à ses admins** : toute commande est refusée aux autres membres, quelles que soient leurs permissions Discord.

- **Owner** : ton ID Discord dans `OWNER_ID` (`.env`) + le propriétaire du serveur. Accès total, seuls à pouvoir gérer les admins. Personne ne peut le sanctionner via le bot.
- **Admins du bot** : gérés via `/setup` → 👑 Admins (sélecteur d'utilisateurs). Accès à toutes les commandes ; ils peuvent agir entre eux (pas de blocage par hiérarchie de rôles, sauf sur le owner).
- Seule limite Discord incontournable : le bot ne peut pas agir sur un membre dont le rôle est **au-dessus du sien** → garder le rôle du bot tout en haut, juste sous le rôle owner.

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

Mise à jour : **`/update` directement sur Discord** (owner uniquement) — vérifie GitHub, applique les commits, réinstalle les dépendances si besoin, redéploie les commandes et redémarre via pm2, avec confirmation après redémarrage. Équivalent manuel : `git pull && npm install && npm run deploy && pm2 restart bot-serveur-discord`

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
