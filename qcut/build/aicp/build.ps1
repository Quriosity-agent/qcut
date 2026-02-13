$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$DistDir = Join-Path $ScriptDir "dist"
$WorkDir = Join-Path $ScriptDir "build-temp"

$AicpSourceRepo = if ($env:AICP_SOURCE_REPO) { $env:AICP_SOURCE_REPO } else { "https://github.com/donghaozhang/video-agent-skill.git" }
$AicpSourceRef = if ($env:AICP_SOURCE_REF) { $env:AICP_SOURCE_REF } else { "v1.0.0" }
$PythonBin = if ($env:AICP_PYTHON_BIN) { $env:AICP_PYTHON_BIN } else { "py -3.12" }

try {
  & $PythonBin --version | Out-Null
} catch {
  Write-Error "[build-aicp] Missing required Python launcher: $PythonBin"
  exit 1
}

& $PythonBin -m venv $VenvDir
$ActivatePath = Join-Path $VenvDir "Scripts\Activate.ps1"
. $ActivatePath

python -m pip install --upgrade pip setuptools wheel
python -m pip install "git+$AicpSourceRepo@$AicpSourceRef"
python -m pip install pyinstaller

pyinstaller "$ScriptDir\aicp.spec" --distpath $DistDir --workpath $WorkDir --clean -y

$BinaryPath = Join-Path $DistDir "aicp.exe"
& $BinaryPath --version

Write-Output "[build-aicp] Built binary: $BinaryPath"
