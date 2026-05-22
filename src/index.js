const core = require('@actions/core');
const exec = require('@actions/exec');
const io = require('@actions/io');
const fs = require('fs');
const path = require('path');

function sanitizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 128);
}

async function run() {
  try {
    const requestedOutdir = core.getInput('outdir') || './sandman_logs';
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const outdir = path.resolve(workspace, requestedOutdir);

    const image = core.getInput('image') || 'trac3x/sandman';
    const imageTag = core.getInput('image-tag') || 'latest';

    const monitorPidInput = core.getInput('monitor-pid');
    const monitorPid = monitorPidInput
      ? Number.parseInt(monitorPidInput, 10)
      : process.ppid;

    if (!Number.isInteger(monitorPid) || monitorPid <= 0) {
      throw new Error(`Invalid monitor PID: ${monitorPidInput || monitorPid}`);
    }

    await io.mkdirP(outdir);

    const runId = process.env.GITHUB_RUN_ID || Date.now().toString();
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';

    const defaultContainerName = sanitizeName(
      `sandman-security-${runId}-${runAttempt}`
    );

    const containerName =
      core.getInput('container-name') || defaultContainerName;

    const imageRef = `${image}:${imageTag}`;

    core.info(`[Sandman] Starting ${imageRef} for host PID ${monitorPid}`);
    core.info(`[Sandman] Writing telemetry to ${outdir}`);

    // GitHub runners use uid/gid 1001 typically.
    // Mapping host user prevents root-owned output files.
    const uid =
      typeof process.getuid === 'function' ? process.getuid() : 1001;

    const gid =
      typeof process.getgid === 'function' ? process.getgid() : 1001;

    const args = [
      'run',
      '-d',
      '--rm',

      '--name',
      containerName,

      '--user',
      `${uid}:${gid}`,

      '--privileged',
      '--pid=host',
      '--network=host',

      '-v',
      '/sys/fs/bpf:/sys/fs/bpf',

      '-v',
      '/sys/kernel/debug:/sys/kernel/debug',

      '-v',
      '/sys/kernel/tracing:/sys/kernel/tracing',

      '-v',
      '/lib/modules:/lib/modules:ro',

      '-v',
      `${outdir}:/app/logs`,

      imageRef,

      '-outdir',
      '/app/logs',

      monitorPid.toString()
    ];

    let containerId = '';

    await exec.exec('docker', args, {
      listeners: {
        stdout: (data) => {
          containerId += data.toString();
        }
      }
    });

    containerId = containerId.trim();

    if (!containerId) {
      throw new Error('Docker did not return a Sandman container ID.');
    }

    const state = {
      containerId,
      containerName,
      outdir,
      retentionDays: core.getInput('retention-days') || '14'
    };

    const stateFile = path.join(
      outdir,
      '.sandman-action-state.json'
    );

    fs.writeFileSync(
      stateFile,
      JSON.stringify(state, null, 2),
      { mode: 0o600 }
    );

    core.saveState('sandman_container_id', containerId);
    core.saveState('sandman_container_name', containerName);
    core.saveState('sandman_outdir', outdir);
    core.saveState(
      'sandman_retention_days',
      state.retentionDays
    );

    core.info(
      `[Sandman] Container running: ${containerName} (${containerId.slice(0, 12)})`
    );
  } catch (error) {
    core.setFailed(
      `Sandman initialization failed: ${error.message}`
    );
  }
}

run();
