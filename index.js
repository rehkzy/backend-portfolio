/* ============================================================
   POINT D'ENTRÉE
   ============================================================
   Sur une offre d'hébergement au disque non-persistant (ex: Render
   gratuit), les données doivent être restaurées AVANT que server.js
   ne démarre — sinon le tableau de bord s'ouvrirait sur une base
   vide le temps que la restauration se termine.

   Si GITHUB_BACKUP_TOKEN n'est pas configuré (ex: hébergement avec
   disque persistant comme Railway + Volume), restoreFromGitHub() ne
   fait rigoureusement rien et server.js démarre immédiatement, comme
   avant.
   ============================================================ */
require('dotenv').config();
const { restoreFromGitHub } = require('./github-backup');

(async () => {
    await restoreFromGitHub();
    require('./server.js');
})();
