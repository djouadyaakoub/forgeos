/**
 * Standalone mock OpenHands Agent Server process for Stage 7 tests.
 * Usage: node runtime/adapters/openhands/mock-agent-server-cli.mjs [port]
 * Prints one JSON line: { baseUrl, port } then serves until SIGTERM.
 */
import { createMockOpenHandsAgentServer } from './mock-agent-server.mjs';

const portArg = Number(process.argv[2] || 0);
const behavior = process.env.MOCK_OH_BEHAVIOR || 'success';
const sessionKey = process.env.MOCK_OH_SESSION_KEY || null;
const version = process.env.MOCK_OH_VERSION || 'mock-agent-server-0.1.0';

const mock = createMockOpenHandsAgentServer({
  behavior,
  sessionKey: sessionKey || null,
  version,
});
const { baseUrl, port } = await mock.listen(portArg);
process.stdout.write(`${JSON.stringify({ baseUrl, port, pid: process.pid })}\n`);

const shutdown = async () => {
  try {
    await mock.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep event loop alive
setInterval(() => {}, 1 << 30);
