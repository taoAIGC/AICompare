const { createRelayServer } = require('./server.js');

async function main() {
  const relayServer = createRelayServer();
  const { port, host } = await relayServer.start();
  console.log(`[remote-relay] listening on ${host}:${port}`);
}

main().catch((error) => {
  console.error('[remote-relay] failed to start:', error);
  process.exitCode = 1;
});
