# Installation and operations

## Install from GitHub

```powershell
dsh plugin add github:hedanzheng/dsh-agent-team-control-plane
```

## Build and install offline

```powershell
npm test
npm pack
dsh plugin add '.\local-agent-team-control-plane-0.5.0.tgz' --offline
```

Restart the selected Harness profile after installation.

## Data location

The database is stored at:

```text
%DSH_HOME%\agent-team-control-plane\control-plane.sqlite
```

Current schema version: `4`.

## Backup

Exit the corresponding Harness Host before backup:

```powershell
.\scripts\backup-control-plane.ps1 `
  -DshHome 'C:\path\to\dsh-home' `
  -Destination 'C:\path\to\backup\control-plane.sqlite'
```

The script checkpoints WAL, copies the database atomically, and returns a SHA-256 hash. It never copies `.credentials.yaml`.

## Restore

Exit the corresponding Harness Host before restore:

```powershell
.\scripts\restore-control-plane.ps1 `
  -DshHome 'C:\path\to\dsh-home' `
  -Backup 'C:\path\to\backup\control-plane.sqlite'
```

The script validates SQLite integrity and replaces the database atomically after removing stale WAL/SHM sidecars.

## Uninstall

```powershell
dsh plugin remove '@local/agent-team-control-plane' --offline
```

Uninstalling the plugin dependency does not delete the control-plane database or Harness credentials.

