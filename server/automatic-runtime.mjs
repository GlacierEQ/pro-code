import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WorkspaceAutomation } from './automation.mjs';
import { startNexusServer } from './nexus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startAutomaticRuntime({ env = process.env, now } = {}) {
  const workspaceRoot = path.resolve(env.PRO_CODE_WORKSPACE_DIR ?? ROOT);
  const automation = new WorkspaceAutomation({
    workspaceRoot,
    outputDir: env.PRO_CODE_RUNTIME_DIR,
    env,
    now,
  });
  const started = await startNexusServer({
    host: env.PRO_CODE_HOST ?? '127.0.0.1',
    port: Number(env.PRO_CODE_PORT ?? 8787),
    env,
    now,
    automation,
  });

  started.server.once('close', () => automation.stop());
  automation.start();
  const startup = automation.run('startup');

  return {
    ...started,
    automation,
    startup,
    async close() {
      automation.stop();
      const closeServer = new Promise((resolve, reject) => {
        started.server.close(error => error ? reject(error) : resolve());
      });
      const [serverResult, automationResult] = await Promise.allSettled([
        closeServer,
        automation.waitForIdle(),
      ]);
      if (serverResult.status === 'rejected') throw serverResult.reason;
      if (automationResult.status === 'rejected') throw automationResult.reason;
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const runtime = await startAutomaticRuntime();
  console.log(`[pro-code] automatic runtime listening at ${runtime.url}`);
  console.log(`[pro-code] workspace: ${runtime.automation.workspaceRoot}`);
  console.log(`[pro-code] artifacts: ${runtime.automation.outputDir}`);
  runtime.startup
    .then(status => {
      const latest = status.latest;
      console.log(
        latest
          ? `[pro-code] automatic inventory complete: ${latest.file_count} files, ${latest.duplicate_groups} duplicate groups, ${latest.high_value_candidates} high-value candidates`
          : '[pro-code] automatic inventory did not produce a summary',
      );
    })
    .catch(error => console.error('[pro-code] automatic inventory failed:', error));
}
