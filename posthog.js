const { PostHog } = require('posthog-node');

const posthog = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
});

process.on('SIGTERM', async () => {
    await posthog.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await posthog.shutdown();
    process.exit(0);
});

module.exports = posthog;
