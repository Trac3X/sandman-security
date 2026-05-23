const core = require('@actions/core');
const exec = require('@actions/exec');
// FIX 2: Use the modern v4 API client exported by @actions/artifact ^2.0.0
const { DefaultArtifactClient } = require('@actions/artifact');
const glob = require('@actions/glob');
const path = require('path');

async function tryExec(command, args) {
  try {
    await exec.exec(command, args, { ignoreReturnCode: true });
  } catch (error) {
    core.warning(`[Sandman] Failed to run ${command} ${args.join(' ')}: ${error.message}`);
  }
}

async function run() {
  try {
    const containerId = core.getState('sandman_container_id');
    const containerName = core.getState('sandman_container_name');
    const outdir = core.getState('sandman_outdir');
    const retentionInput = core.getState('sandman_retention_days') || '14';
    const retentionDays = Number.parseInt(retentionInput, 10);

    // Stop telemetry container
    if (containerId || containerName) {
      const target = containerId || containerName;
      core.info(`[Sandman] Stopping telemetry container: ${target}`);
      await tryExec('docker', ['stop', '--timeout', '5', target]);
    } else {
      core.warning('[Sandman] No container state was found; skipping stop.');
    }

    if (!outdir) {
      core.warning('[Sandman] No output directory state was found; skipping artifact upload.');
      return;
    }

    // FIX 3: Bulletproof permissions bypass. Root created the files, so we unlock them for everyone.
    await tryExec('sudo', ['chmod', '-R', '777', outdir]);

    core.info('[Sandman] Collecting telemetry artifacts.');

    const globber = await glob.create(path.join(outdir, '*.jsonl'));
    const files = await globber.glob();

    if (files.length === 0) {
      core.warning('[Sandman] No telemetry logs were generated.');
      await tryExec('ls', ['-lah', outdir]);
      return;
    }

    core.info(`[Sandman] Found ${files.length} telemetry file(s).`);

    for (const file of files) {
      core.info(`[Sandman] Previewing ${file}`);
      await tryExec('bash', ['-c', `head -n 20 "${file}" || true`]);
    }

    // FIX 4: Initialize the v4 Artifact Client
    const artifactClient = new DefaultArtifactClient();

    // FIX 5: Ensure the artifact name is 100% unique per run to prevent 400 Bad Request collisions
    const runId = process.env.GITHUB_RUN_ID || Date.now();
    const artifactName = `sandman-telemetry-logs-${runId}`;

    await artifactClient.uploadArtifact(
      artifactName,
      files,
      path.resolve(outdir),
      {
        retentionDays: Number.isInteger(retentionDays) ? retentionDays : 14
      }
    );

    core.info(`[Sandman] Telemetry uploaded successfully: ${artifactName}`);
  } catch (error) {
    core.setFailed(`Sandman post-run failed: ${error.message}`);
  }
}

run();
