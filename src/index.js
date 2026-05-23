const core = require('@actions/core');
const io = require('@actions/io');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const requestedOutdir = core.getInput('outdir') || './sandman_logs';
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const outdir = path.resolve(workspace, requestedOutdir);
    const imageRef = `${core.getInput('image') || 'trac3x/sandman'}:${core.getInput('image-tag') || 'latest'}`;

    // 1. Prepare the output directory and unlock permissions for Docker root writes
    await io.mkdirP(outdir);
    require('child_process').execSync(`sudo chmod -R 777 ${outdir}`);

    // 2. Synthesize the JIT Execution Wrapper
    // This script grabs its own PID, starts the eBPF container targeting itself,
    // and then uses `exec` to replace itself with the malware payload.
    const wrapperScript = `#!/bin/bash
set -e

TARGET_PID=$$
echo "[Sandman] Intercepting execution. Attaching eBPF sensors to PID: $TARGET_PID"

# Start the sensor dynamically, tracking ONLY this exact execution tree
docker run -d --rm \\
  --name sandman-ebpf-session \\
  --privileged \\
  --pid=host \\
  --network=host \\
  -v /sys/fs/bpf:/sys/fs/bpf \\
  -v /sys/kernel/debug:/sys/kernel/debug \\
  -v /sys/kernel/tracing:/sys/kernel/tracing \\
  -v /lib/modules:/lib/modules:ro \\
  -v ${outdir}:/app/logs \\
  ${imageRef} \\
  -outdir /app/logs $TARGET_PID > /dev/null

# Allow 1.5 seconds for eBPF kernel probes to securely lock into the Ring 0 subsystems
sleep 1.5
echo "[Sandman] Subsystem locked. Executing payload..."

# Replace the current bash process with the requested malware command
exec "$@"
`;

    // 3. Inject the wrapper into the GitHub Actions system path
    const wrapperPath = '/usr/local/bin/sandman-run';
    fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 });

    // 4. Save state so post.js knows exactly what to tear down
    core.saveState('sandman_container_name', 'sandman-ebpf-session');
    core.saveState('sandman_outdir', outdir);
    core.saveState('sandman_retention_days', core.getInput('retention-days') || '14');

    core.info(`[Sandman] Injector prepared. Use 'sandman-run <command>' in your workflow to safely trace payloads without .NET noise.`);
  } catch (error) {
    core.setFailed(`Sandman initialization failed: ${error.message}`);
  }
}

run();
