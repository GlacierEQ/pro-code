import { spawn } from 'node:child_process';
import path from 'node:path';

// Helper invoked as a separate process by code-fix.mjs. It supervises one
// explicitly supplied Node test file and kills its POSIX process group on
// timeout/output overflow, including ordinary descendants that inherit it.
// It never uses a shell or accepts arbitrary commands from a document.
const [testFile, timeoutText] = process.argv.slice(2);
const timeoutMs = Number(timeoutText);
if (!testFile || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  process.stderr.write('verified test supervisor requires file and 1000..120000 ms timeout\n');
  process.exitCode = 2;
} else {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const useGroup = process.platform !== 'win32';
  const child = spawn(process.execPath, ['--test', testFile], {
    cwd: process.cwd(), env, shell: false, detached: useGroup,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let outputOverflow = false;
  let spawnError = null;
  let reported = false;
  const limit = 1_048_576;
  function killTree() {
    try {
      if (useGroup && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') spawnError = String(error);
    }
  }
  function append(which, chunk) {
    const value = chunk.toString('utf8');
    if (which === 'out') stdout = (stdout + value).slice(-limit);
    else stderr = (stderr + value).slice(-limit);
    if (Buffer.byteLength(value) > limit || (which === 'out'
      ? Buffer.byteLength(stdout) >= limit : Buffer.byteLength(stderr) >= limit)) {
      outputOverflow = true;
      killTree();
    }
  }
  child.stdout.on('data', chunk => append('out', chunk));
  child.stderr.on('data', chunk => append('err', chunk));
  child.on('error', error => { spawnError = error.message; });
  const timeout = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
  // If a descendant escapes the process group and retains a pipe, do not
  // block forever: close the pipes and return an explicitly failed result.
  const hardLimit = setTimeout(() => {
    timedOut = true;
    killTree();
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    finish(null, 'forced-timeout');
  }, timeoutMs + 3_000);
  function finish(code, signal) {
    if (reported) return;
    reported = true;
    clearTimeout(timeout);
    clearTimeout(hardLimit);
    const matchTests = /^# tests (\d+)$/m.exec(stdout);
    const matchPassed = /^# pass (\d+)$/m.exec(stdout);
    const registered = [...stdout.matchAll(/^# Subtest: (.+)$/gm)]
      .map(match => match[1].trim())
      .filter(name => name !== testFile && name !== path.basename(testFile));
    process.stdout.write(JSON.stringify({
      exit_code: code, signal, timed_out: timedOut, output_overflow: outputOverflow,
      tests_executed: matchTests ? Number(matchTests[1]) : 0,
      tests_passed: matchPassed ? Number(matchPassed[1]) : 0,
      registered_subtests: registered.length,
      process_group_killed: timedOut || outputOverflow ? useGroup : false,
      spawn_error: spawnError, stdout_tail: stdout.slice(-2048), stderr_tail: stderr.slice(-2048),
    }) + '\n');
  }
  child.on('close', (code, signal) => finish(code, signal));
}
