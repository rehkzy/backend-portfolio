# Dashboard Florian B. — Backend + Admin

Backend Node.js (Express + SQLite) qui capture tous les leads et demandes de RDV envoyés par l'assistant IA du site, et un dashboard d'administration (style Shopify) pour les consulter et les gérer.

## 1. Installation locale

```bash
cd backend
npm install
cp .env.example .env
```

Générez le hash de votre mot de passe admin :

```bash
npm run hash-password -- "VotreMotDePasseSecurise"
```

Collez la ligne `ADMIN_PASSWORD_HASH=...` obtenue dans votre fichier `.env`, puis générez un `JWT_SECRET` aléatoire (n'importe quelle longue chaîne, ex: `openssl rand -hex 32`).

Lancez le serveur :

```bash
npm start
```

Le dashboard est accessible sur **http://localhost:4000/dashboard**
L'API répond sur **http://localhost:4000/api/...**

## 2. Connecter le site au backend

Une fois le backend déployé (étape 3), ouvrez `index.html` (le site), cherchez cette ligne dans le script de l'assistant IA :

```js
const BACKEND_URL = '';
```

Remplacez-la par l'URL de votre backend déployé, par exemple :

```js
const BACKEND_URL = 'https://florianb-backend.onrender.com';
```

À partir de ce moment, chaque message de contact et chaque demande de RDV envoyés via le chat du site remontent automatiquement dans le dashboard — en plus de l'email envoyé par FormSubmit.

## 3. Déploiement sur OVH — Hébergement Web Cloud (ton cas)

Bonne nouvelle : l'Hébergement Web Cloud OVH supporte Node.js nativement via son "moteur d'exécution". Le stockage est persistant (contrairement à Render gratuit), donc ta base SQLite ne sera pas effacée entre deux redémarrages.

**Recommandation** : héberge l'API sur un sous-domaine dédié, par exemple `api.florian-b.fr`, pendant que `florian-b.fr` reste ton site statique (`index.html`). C'est possible sur un seul et même hosting Web Cloud grâce à la fonctionnalité Multisite (chaque sous-domaine peut avoir son propre moteur d'exécution).

### Étapes dans le Manager OVH

1. **Espace Web** → ton hébergement → onglet **Multisite** → **Ajouter un site**, renseigne `api.florian-b.fr` (ou crée d'abord l'enregistrement DNS du sous-domaine si ce n'est pas automatique).
2. Sur ce site, va dans l'onglet **Moteurs d'exécution**, clique sur l'icône à droite → **Modifier**, et choisis le moteur **Node.js** (dernière version disponible, Node 18+).
3. Renseigne :
   - **Script de lancement de l'application** : `server.js`
   - **Répertoire public** : `public`
   - **Environnement** : `development` dans un premier temps (tu auras une page d'aide qui liste les erreurs/modules manquants), puis repasse en **`production`** une fois que tout fonctionne.
4. Récupère tes identifiants **SSH** dans l'onglet **FTP-SSH**, puis connecte-toi :
   ```bash
   ssh tonlogin@ton-serveur.ovh.net -p <port>
   ```
5. Dépose les fichiers du dossier `backend/` (tout sauf `node_modules`) dans `www/` (ou le sous-dossier configuré pour `api.florian-b.fr` s'il y a plusieurs sites).
6. Installe les dépendances avec le binaire npm spécifique à la version Node choisie (remplace `20` par ta version) :
   ```bash
   npm-node20 install
   ```
7. Crée le fichier `.env` directement sur le serveur (ne le mets jamais dans un repo public) avec `JWT_SECRET`, `ADMIN_PASSWORD_HASH` (généré en local avec `npm run hash-password`) et `ALLOWED_ORIGIN=https://florian-b.fr`.
8. Dans le Manager, clique sur **Redémarrer** (onglet Multisite, icône à droite du site).
9. Vérifie sur **Accès HTTP au cluster** (onglet Informations générales) si des erreurs de démarrage apparaissent (module manquant, fichier introuvable...).
10. Une fois que ça tourne : `https://api.florian-b.fr/dashboard` = ton dashboard, `https://api.florian-b.fr/api/...` = ton API.

Puis dans `index.html`, mets à jour :
```js
const BACKEND_URL = 'https://api.florian-b.fr';
```

### Options de déploiement génériques (alternative)

### Option simple — Render.com (gratuit pour démarrer)
1. Créez un compte sur render.com, "New Web Service", connectez ce dossier `backend/` (via un repo Git).
2. Build command : `npm install` — Start command : `npm start`
3. Ajoutez les variables d'environnement (`JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `ALLOWED_ORIGIN`) dans l'onglet Environment.
4. ⚠️ Le plan gratuit de Render a un disque **éphémère** : la base SQLite sera réinitialisée à chaque redéploiement/redémarrage. Pour des données persistantes, ajoutez un "Persistent Disk" (payant, ~1$/mois) monté sur le dossier `backend/`, ou passez à l'option Railway ci-dessous.

### Option recommandée pour la persistance — Railway.app
Railway propose un volume persistant simple à attacher, même en petit budget. Déployez le dossier `backend/`, attachez un volume sur `/app/data`, et adaptez le chemin de la base dans `db.js` si besoin.

### Option VPS (le plus fiable)
Sur un petit VPS (OVH, Hetzner, DigitalOcean...) :
```bash
git clone ... && cd backend
npm install --production
npm run hash-password -- "..."
# configurez .env
npm install -g pm2
pm2 start server.js --name florianb-backend
pm2 save && pm2 startup
```
Mettez Nginx ou Caddy devant pour le HTTPS et pointez `ALLOWED_ORIGIN` vers votre domaine.

## 4. Sécurité

- Le dashboard n'a qu'un seul compte admin protégé par mot de passe hashé (bcrypt) + session JWT (7 jours).
- Les routes `/api/leads` et `/api/appointments` en **POST** sont volontairement publiques (c'est le chat du site qui les appelle sans authentification) — mais en **GET/PATCH/DELETE** elles nécessitent le token admin.
- Pensez à restreindre `ALLOWED_ORIGIN` à votre vrai domaine en production (pas `*`).
- Le mot de passe n'est jamais stocké en clair, seulement son hash bcrypt.

## 5. Ce que le dashboard affiche

- **Overview** : nouveaux leads (7 jours), total leads, RDV en attente, taux de conversion, courbe des leads sur 30 jours, répartition par statut.
- **Leads** : recherche, filtres par statut, panneau de détail avec changement de statut (Nouveau → Contacté → Gagné/Perdu) et notes internes.
- **Rendez-vous** : mêmes fonctionnalités, statuts (En attente → Confirmé → Terminé/Annulé).
- Thème clair/sombre, palette command (⌘K / Ctrl+K) pour naviguer au clavier.

## 6. Étendre le système

Le dashboard est volontairement en HTML/JS simple (pas de build step) pour rester facile à modifier. Pour ajouter une donnée :
1. Ajoutez la colonne dans `db.js`
2. Exposez-la dans la route correspondante de `server.js`
3. Affichez-la dans `public/index.html`
