import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

// Fail on a busy port rather than attaching a native bridge to an unrelated server.
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
server.printUrls();
const child = spawn(electron, [
  ...(process.argv.includes('--inspect') ? ['--inspect=127.0.0.1:9229'] : []), '.', '--dev',
], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
child.once('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
child.once('exit', async (code) => { await server.close(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
