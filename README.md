# Backend Florian B. — Guide de déploiement Railway

## Ce que contient ce dossier

| Fichier | Rôle |
|---|---|
| `server.js` | Le serveur Node.js principal |
| `db.js` | La base de données SQLite (leads, RDV, contenu du site) |
| `public/index.html` | Le dashboard admin |
| `scripts/hash-password.js` | Outil pour créer ton mot de passe |
| `railway.json` | Config auto pour Railway |
| `.env.example` | Template des variables d'environnement |

---

## Étape 1 — Préparer le mot de passe admin (sur ton Mac)

Tu dois d'abord installer Node.js si ce n'est pas déjà fait :
→ https://nodejs.org (télécharge la version LTS)

Ensuite dans Terminal :
```bash
cd /chemin/vers/ce/dossier
npm install
node scripts/hash-password.js
```
Tape le mot de passe que tu veux utiliser pour te connecter au dashboard.
**Copie le hash affiché** (commence par `$2b$...`), tu en auras besoin à l'étape 3.

---

## Étape 2 — Mettre le dossier sur GitHub

1. Va sur https://github.com → connecte-toi (ou crée un compte gratuit)
2. Clique **"New repository"** (bouton vert en haut à droite)
3. Nomme-le `florianb-backend`, mets-le en **Private** ← important
4. Clique **"Create repository"**
5. Sur la page qui s'affiche, copie l'URL du repo (ex: `https://github.com/tonpseudo/florianb-backend`)

Dans Terminal :
```bash
cd /chemin/vers/ce/dossier
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/tonpseudo/florianb-backend
git push -u origin main
```

> ⚠️ Le fichier `.gitignore` est déjà configuré pour **ne jamais envoyer** ton `.env`, ta base de données ni tes uploads sur GitHub.

---

## Étape 3 — Déployer sur Railway

1. Va sur https://railway.app
2. Clique **"Login"** → **"Login with GitHub"** → autorise Railway
3. Clique **"New Project"**
4. Clique **"Deploy from GitHub repo"**
5. Sélectionne **`florianb-backend`**
6. Railway détecte automatiquement que c'est du Node.js et lance le déploiement

### Ajouter les variables d'environnement sur Railway

Une fois le projet créé, dans Railway :
1. Clique sur ton service
2. Onglet **"Variables"**
3. Clique **"New Variable"** et ajoute ces 4 variables une par une :

| Nom | Valeur |
|---|---|
| `JWT_SECRET` | N'importe quelle longue chaîne random, ex: `xK9p2mZ7qRtL3nP8wVcY` |
| `ADMIN_PASSWORD_HASH` | Le hash copié à l'étape 1 (commence par `$2b$...`) |
| `ALLOWED_ORIGIN` | `https://florian-b.fr,https://www.florian-b.fr` |
| `PORT` | `4000` |

4. Railway redémarre automatiquement le serveur.

### Récupérer l'URL de ton backend

Dans Railway, onglet **"Settings"** → section **"Networking"** → clique **"Generate Domain"**.
Tu obtiens une URL du type : `https://florianb-backend-production.up.railway.app`

**Garde cette URL**, tu en auras besoin à l'étape 4.

---

## Étape 4 — Connecter le site à ce backend

Dans ton fichier `index.html` du site, cherche cette ligne (~ligne 1533) :
```js
const BACKEND_URL = '';
```

Remplace par ton URL Railway :
```js
const BACKEND_URL = 'https://florianb-backend-production.up.railway.app';
```

Upload ce `index.html` mis à jour dans `www/` via FileZilla. C'est tout.

---

## Accéder au dashboard

→ `https://florianb-backend-production.up.railway.app/dashboard`

Tu te connectes avec le mot de passe choisi à l'étape 1.

Tu verras 3 sections :
- **Leads / Rendez-vous** — les contacts reçus via le chat IA
- **Contenu du site** — Hero, Projets, Galerie photo, FAQ (modifiable sans toucher au code)

---

## En local (pour tester avant de déployer)

```bash
# Copie le fichier d'environnement
cp .env.example .env
# Remplis .env avec tes vraies valeurs

# Lance le serveur
npm start
```

Dashboard accessible sur : http://localhost:4000/dashboard
