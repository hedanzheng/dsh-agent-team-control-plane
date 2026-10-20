param(
  [Parameter(Mandatory = $true)][string]$DshHome,
  [string]$Destination = ''
)
$ErrorActionPreference = 'Stop'
$dshRoot = [IO.Path]::GetFullPath($DshHome)
$database = Join-Path $dshRoot 'agent-team-control-plane\control-plane.sqlite'
if (-not (Test-Path -LiteralPath $database -PathType Leaf)) { throw "Control Plane database not found: $database" }
if (-not $Destination) { $Destination = Join-Path $dshRoot ("agent-team-control-plane-backup-{0}.sqlite" -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$target = [IO.Path]::GetFullPath($Destination)
if ($target -eq $database) { throw 'Destination must differ from the live database' }
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();" $database
if ($LASTEXITCODE -ne 0) { throw 'SQLite checkpoint failed; stop the Host and retry' }
$temporary = "$target.$PID.tmp"
Copy-Item -LiteralPath $database -Destination $temporary -Force
Move-Item -LiteralPath $temporary -Destination $target -Force
$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
[pscustomobject]@{ path = $target; sha256 = $hash; size = (Get-Item -LiteralPath $target).Length }
