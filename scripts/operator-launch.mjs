import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./operate.py', import.meta.url));
const targets = process.platform === 'win32'
  ? [['py', '-3'], ['python'], ['python3']]
  : [['python3'], ['python']];
let launched = false;
for (const candidate of targets) {
  const result = spawnSync(candidate[0], [...candidate.slice(1), script, ...process.argv.slice(2)], {
    stdio: 'inherit', shell: false,
  });
  if (result.error?.code === 'ENOENT') continue;
  launched = true;
  if (result.error) {
    process.stderr.write('operator launcher failed: ' + result.error.message + '\n');
    process.exitCode = 2;
  } else {
    process.exitCode = result.status ?? 1;
  }
  break;
}
if (!launched) {
  process.stderr.write('operator requires an available Python 3 interpreter\n');
  process.exitCode = 2;
}
