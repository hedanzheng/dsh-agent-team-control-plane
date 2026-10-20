param(
  [Parameter(Mandatory = $true)][string]$DshHome,
  [Parameter(Mandatory = $true)][string]$Backup
)
$ErrorActionPreference = 'Stop'
$dshRoot = [IO.Path]::GetFullPath($DshHome)
$source = [IO.Path]::GetFullPath($Backup)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Backup not found: $source" }
$directory = Join-Path $dshRoot 'agent-team-control-plane'
$database = Join-Path $directory 'control-plane.sqlite'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
Remove-Item -LiteralPath "$database-wal" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$database-shm" -Force -ErrorAction SilentlyContinue
$temporary = "$database.$PID.tmp"
Copy-Item -LiteralPath $source -Destination $temporary -Force
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1],{readOnly:true}); const row=db.prepare('PRAGMA integrity_check').get(); console.log(JSON.stringify(row)); db.close();" $temporary
if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $temporary -Force; throw 'backup integrity check failed' }
Move-Item -LiteralPath $temporary -Destination $database -Force
[pscustomobject]@{ path = $database; sha256 = (Get-FileHash -LiteralPath $database -Algorithm SHA256).Hash }
