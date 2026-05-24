const core = require('@actions/core');
const io = require('@actions/io');
const fs = require('fs');
const path = require('path');
const exec = require('@actions/exec');

async function run() {
  try {
    const requestedOutdir = core.getInput('outdir') || './sandman_logs';
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const outdir = path.resolve(workspace, requestedOutdir);
    const imageRef = `${core.getInput('image') || 'trac3x/sandman'}:${core.getInput('image-tag') || 'latest'}`;

    // 1. Prepare output directory with absolute open permissions
    await io.mkdirP(outdir);
    await exec.exec('sudo', ['chmod', '-R', '777', outdir]);

    // 2. Synthesize the JIT Execution Wrapper
    // Notice we REMOVED the '--rm' flag so the container persists if it crashes.
    // We also use -outdir=/app/logs to ensure Go parses the flag safely.
    const wrapperScript = `#!/bin/bash
set -e

TARGET_PID=$$
echo "[Sandman] Intercepting execution. Attaching eBPF sensors to PID: $TARGET_PID"

docker run -d \\
  --name sandman-ebpf-session \\
  --privileged \\
  --pid=host \\
  --network=host \\
  -v /sys/fs/bpf:/sys/fs/bpf \\
  -v /sys/kernel/debug:/sys/kernel/debug \\
  -v /sys/kernel/tracing:/sys/kernel/tracing \\
  -v /lib/modules:/lib/modules:ro \\
  -v "${outdir}:/app/logs" \\
  ${imageRef} \\
  -outdir=/app/logs $TARGET_PID

echo "[Sandman] Kernel sensors deploying. Waiting 2 seconds for Ring-0 lock..."
sleep 2

echo "[Sandman] Subsystem locked. Executing payload: $@"
exec "$@"
`;

    // 3. Inject the wrapper into the GitHub Actions system path
    const wrapperPath = '/usr/local/bin/sandman-run';
    fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 });

    // Ensure it is executable
    await exec.exec('sudo', ['chmod', '+x', wrapperPath]);

    // 4. Save state for teardown
    core.saveState('sandman_container_name', 'sandman-ebpf-session');
    core.saveState('sandman_outdir', outdir);
    core.saveState('sandman_retention_days', core.getInput('retention-days') || '14');

    core.info(`[Sandman] Injector prepared. Target wrapper deployed to ${wrapperPath}`);
  } catch (error) {
    core.setFailed(`Sandman initialization failed: ${error.message}`);
  }
}

run();
