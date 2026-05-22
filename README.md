# sandman-security

Docker-backed GitHub Action for running Sandman as an eBPF build-time telemetry sensor in CI.

The action starts a privileged Sandman container in the main phase and stops it in the post phase. The container runs with the host PID namespace so Sandman can monitor the GitHub Actions runner process tree and automatically track child processes through Sandman's fork lineage map.

## Usage

```yaml
jobs:
  build-and-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6.0.2

      - name: Initialize Sandman
        uses: Trac3X/sandman-security@v0.0.1
        with:
          image: trac3x/sandman
          image-tag: latest
          outdir: ./sandman_logs

      - name: Run build
        run: npm install
```

## Inputs

- `outdir`: directory for JSONL telemetry logs. Default: `./sandman_logs`
- `image`: Sandman Docker image. Default: `trac3x/sandman`
- `image-tag`: Sandman Docker image tag. Default: `latest`
- `container-name`: optional Docker container name
- `retention-days`: uploaded artifact retention days. Default: `14`
- `monitor-pid`: host PID to monitor. Defaults to the parent PID of this action's Node process.

## Runner Requirements

This action requires a Linux runner with Docker available and permission to run privileged containers. The container uses:

```text
--privileged
--pid=host
--network=host
-v /sys/fs/bpf:/sys/fs/bpf
-v /sys/kernel/debug:/sys/kernel/debug
-v /sys/kernel/tracing:/sys/kernel/tracing
-v /lib/modules:/lib/modules:ro
```

## Development

Install dependencies and build the checked-in `dist/` files:

```bash
npm install
npm run build
```

