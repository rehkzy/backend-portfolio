const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
    console.log('\nUsage : npm run hash-password -- "votreMotDePasse"\n');
    process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log('\n✅ Ajoutez cette ligne à votre fichier .env :\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
