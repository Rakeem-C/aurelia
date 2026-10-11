param([string]$EditorPath='C:\Users\justa\AppData\Local\Unity\Editors\6000.3.26f1\Editor\Unity.exe')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$project=Join-Path $root 'Unity'
$logs=Join-Path $root '.qa'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$args=@('-batchmode','-nographics','-quit','-projectPath',$project,'-buildTarget','WebGL','-executeMethod','AureliaBuild.Web','-logFile',(Join-Path $logs 'unity-build.log'))
$process=Start-Process -FilePath $EditorPath -ArgumentList ($args | ForEach-Object {'"'+$_+'"'}) -WindowStyle Hidden -PassThru
$process.WaitForExit()
if($process.ExitCode -ne 0){throw "Unity build failed with exit code $($process.ExitCode). See .qa/unity-build.log."}
Push-Location $root
try {node scripts/finalize-build.mjs; if($LASTEXITCODE -ne 0){throw 'Build manifest generation failed'}} finally {Pop-Location}
