/* ============================================================
   WEBHOOK DISCORD / SLACK
   ============================================================
   Envoie un message dans un salon Discord et/ou un canal Slack à
   chaque événement important (nouveau lead, nouveau RDV...). Les
   deux sont indépendants et optionnels — configure celui que tu
   utilises, ignore l'autre. Si aucun des deux n'est configuré, cette
   fonction ne fait rigoureusement rien.
   ============================================================ */

async function notifyWebhooks(message) {
    const jobs = [];

    if (process.env.DISCORD_WEBHOOK_URL) {
        jobs.push(
            fetch(process.env.DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: message }),
            }).catch((e) => console.warn('⚠️  Webhook Discord échoué :', e.message))
        );
    }

    if (process.env.SLACK_WEBHOOK_URL) {
        jobs.push(
            fetch(process.env.SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: message }),
            }).catch((e) => console.warn('⚠️  Webhook Slack échoué :', e.message))
        );
    }

    if (!jobs.length) return;
    await Promise.all(jobs);
}

module.exports = { notifyWebhooks };
