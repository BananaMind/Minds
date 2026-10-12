// One executable, two roles: the Minds window/tray app, or (spawned by it) the bots' on-screen cursor overlay.
if (process.argv.includes('--minds-overlay')) await import('@bananamind/core/overlay');
else await import('./app.mjs');
