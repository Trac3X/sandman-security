const core = require('@actions/core');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');
const glob = require('@actions/glob');
const path = require('path');

async function tryExec(command, args) {
  try {
    await exec.exec(command, args, {
      ignoreReturnCode: true
    });
  } catch (error) {
    core.warning(
      `[Sandman] Failed to run ${command} ${args.join(' ')}: ${error.message}`
    );
  }
}

async function run() {
  try {
    const containerId =
      core.getState('sandman_container_id');

    const containerName =
      core.getState('sandman_container_name');

    const outdir =
      core.getState('sandman_outdir');

    const retentionInput =
      core.getState('sandman_retention_days') || '14';

    const retentionDays =
      Number.parseInt(retentionInput, 10);

    // Stop telemetry container
    if (containerId || containerName) {
      const target = containerId || containerName;

      core.info(
        `[Sandman] Stopping telemetry container: ${target}`
      );

      await tryExec('docker', [
        'stop',
        '--timeout',
        '5',
        target
      ]);
    } else {
      core.warning(
        '[Sandman] No container state was found; skipping stop.'
      );
    }

    // Validate output directory
    if (!outdir) {
      core.warning(
        '[Sandman] No output directory state was found; skipping artifact upload.'
      );
      return;
    }

    // Fix permissions so GitHub runner can read logs
    await tryExec('sudo', [
      'chown',
      '-R',
      'runner:runner',
      outdir
    ]);

    core.info(
      '[Sandman] Collecting telemetry artifacts.'
    );

    // Find telemetry files
    const globber = await glob.create(
      path.join(outdir, '*.jsonl')
    );

    const files = await globber.glob();

    if (files.length === 0) {
      core.warning(
        '[Sandman] No telemetry logs were generated.'
      );

      await tryExec('ls', ['-lah', outdir]);

      return;
    }

    core.info(
      `[Sandman] Found ${files.length} telemetry file(s).`
    );

    // Print preview in GitHub Actions logs
    for (const file of files) {
      core.info(`[Sandman] Previewing ${file}`);

      await tryExec('bash', [
        '-c',
        `head -n 20 "${file}" || true`
      ]);
    }

    // Modern artifact API
    const artifactClient = artifact.create();

    // Keep artifact name simple and valid
    const artifactName = 'sandman-telemetry';

    await artifactClient.uploadArtifact(
      artifactName,
      files,
      path.resolve(outdir),
      {
        retentionDays: Number.isInteger(retentionDays)
          ? retentionDays
          : 14
      }
    );

    core.info(
      `[Sandman] Telemetry uploaded successfully: ${artifactName}`
    );
  } catch (error) {
    core.setFailed(
      `Sandman post-run failed: ${error.message}`
    );
  }
}

run();
