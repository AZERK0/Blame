$ErrorActionPreference = "Stop"

$DistroName = "BlameRuntime"
$RuntimeHome = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $RuntimeHome "manifest.json"
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$RuntimeVersion = [string]$Manifest.runtimeVersion
$ClineSdkVersion = "0.0.46"
$WslRequiredAction = "Enable WSL2 in Windows, restart if prompted, then run Blame runtime setup again."
$RootfsAction = "Blame could not download the BlameRuntime WSL2 rootfs. Check the internet connection, then run Blame runtime setup again."

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-WslHost {
  param([string[]]$WslArgs)
  $output = & wsl.exe @WslArgs 2>&1
  [pscustomobject]@{
    Code = $LASTEXITCODE
    Output = ($output -join "`n")
  }
}

function Invoke-Distro {
  param([string]$Command)
  Invoke-WslHost -WslArgs @("-d", $DistroName, "-u", "root", "--", "sh", "-lc", $Command)
}

function Write-Status {
  param([string]$Status, [object[]]$Checks, [string]$Action = "")
  $report = [ordered]@{
    status = $Status
    checks = $Checks
  }
  if ($Action) {
    $report.action = $Action
  }
  $report | ConvertTo-Json -Depth 4 -Compress
}

function New-Check {
  param([string]$Name, [string]$Status, [string]$Action = "")
  $check = [ordered]@{
    name = $Name
    status = $Status
  }
  if ($Action) {
    $check.action = $Action
  }
  [pscustomobject]$check
}

function Get-WslListText {
  $result = Invoke-WslHost -WslArgs @("--list", "--verbose")
  ($result.Output -replace "`0", "")
}

function Test-WslAvailable {
  $result = Invoke-WslHost -WslArgs @("--status")
  $result.Code -eq 0
}

function Test-DistroPresentText {
  param([string]$Text)
  $Text -match "(?m)^\s*\*?\s*$([regex]::Escape($DistroName))\s"
}

function Test-DistroPresent {
  Test-DistroPresentText (Get-WslListText)
}

function Test-DistroUsesWsl2Text {
  param([string]$Text)
  $Text -match "(?m)^\s*\*?\s*$([regex]::Escape($DistroName))\s+\S+\s+2\s*$"
}

function Test-DistroUsesWsl2 {
  Test-DistroUsesWsl2Text (Get-WslListText)
}

function Test-ContainerRuntimeCommand {
  param([string[]]$CommandArgs)
  if ($CommandArgs[0] -match "^(compose|container|info|inspect|network|volume)$") {
    return $true
  }
  $CommandArgs[0] -eq "sh" -and (($CommandArgs -join " ") -match "\bnerdctl\b")
}

function Ensure-ContainerdRunning {
  $command = "if ! pgrep -x containerd >/dev/null 2>&1; then mkdir -p /run/containerd /var/log/blame-runtime; nohup containerd >/var/log/blame-runtime/containerd.log 2>&1 & sleep 2; fi; test -S /run/containerd/containerd.sock"
  $result = Invoke-Distro $command
  if ($result.Code -ne 0) {
    throw $result.Output
  }
}

function Get-StatusChecks {
  $checks = New-Object System.Collections.Generic.List[object]
  if (-not (Test-WslAvailable)) {
    $checks.Add((New-Check "wsl" "unsupported" $WslRequiredAction))
    return $checks
  }
  $checks.Add((New-Check "wsl" "available"))
  $wslListText = Get-WslListText
  if (-not (Test-DistroPresentText $wslListText)) {
    $checks.Add((New-Check "distro" "missing" "Create the BlameRuntime WSL2 distro from Blame runtime setup."))
    return $checks
  }
  $checks.Add((New-Check "distro" "available"))
  if (-not (Test-DistroUsesWsl2Text $wslListText)) {
    $checks.Add((New-Check "wsl2" "unsupported" "Convert BlameRuntime to WSL2 with wsl --set-version BlameRuntime 2, then retry."))
    return $checks
  }
  $checks.Add((New-Check "wsl2" "available"))
  Add-DistroChecks $checks
  $checks
}

function Add-DistroChecks {
  param([System.Collections.Generic.List[object]]$Checks)
  $command = @'
check() {
  name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '%s\tavailable\n' "$name"
  else
    printf '%s\tmissing\n' "$name"
  fi
}
node_major_ok() {
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
}
valid_cline_sdk_install() {
  node_major_ok
  global_node_root="$(npm root -g)"
  node - "$global_node_root" "__CLINE_SDK_VERSION__" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const version = process.argv[3];
const sdkPackage = path.join(root, "@cline/sdk/package.json");
const coreRoots = [
  path.join(root, "@cline/core"),
  path.join(root, "@cline/sdk/node_modules/@cline/core"),
];
const coreRoot = coreRoots.find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
if (!fs.existsSync(sdkPackage) || !coreRoot) process.exit(1);
const sdk = JSON.parse(fs.readFileSync(sdkPackage, "utf8"));
const core = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"));
const sdkEntry = path.join(root, "@cline/sdk/dist/index.js");
process.exit(sdk.version === version && core.version === version && fs.existsSync(sdkEntry) ? 0 : 1);
NODE
}
check agent test -x /usr/local/bin/blame-runtime-agent
check containerd sh -lc 'command -v containerd >/dev/null 2>&1 && pgrep -x containerd >/dev/null 2>&1 && test -S /run/containerd/containerd.sock'
check nerdctl sh -lc 'command -v nerdctl >/dev/null 2>&1'
check nerdctl-compose sh -lc 'nerdctl compose version >/dev/null 2>&1'
check git sh -lc 'command -v git >/dev/null 2>&1'
check cline-sdk valid_cline_sdk_install
'@ -replace "__CLINE_SDK_VERSION__", $ClineSdkVersion
  $result = Invoke-Distro $command
  if ($result.Code -ne 0) {
    foreach ($name in @("agent", "containerd", "nerdctl", "nerdctl-compose", "git", "cline-sdk")) {
      $Checks.Add((New-Check $name "missing" "Repair BlameRuntime from Blame runtime setup."))
    }
    return
  }
  foreach ($line in ($result.Output -split "`n")) {
    if (-not $line.Trim()) {
      continue
    }
    $parts = $line -split "`t", 2
    if ($parts.Count -ne 2) {
      continue
    }
    if ($parts[1] -eq "available") {
      $Checks.Add((New-Check $parts[0] "available"))
    } else {
      $Checks.Add((New-Check $parts[0] "missing" "Repair BlameRuntime from Blame runtime setup."))
    }
  }
}

function Get-RuntimeStatus {
  $checks = Get-StatusChecks
  $failed = $checks | Where-Object { $_.status -ne "available" } | Select-Object -First 1
  if ($null -eq $failed) {
    Write-Status "ready" $checks
    return
  }
  if ($failed.name -eq "wsl" -or $failed.name -eq "wsl2") {
    Write-Status "unsupported" $checks $failed.action
    return
  }
  if ($failed.name -eq "distro" -or $failed.name -eq "agent") {
    Write-Status "missing" $checks $failed.action
    return
  }
  Write-Status "repairable" $checks $failed.action
}

function Assert-WslReady {
  if (Test-WslAvailable) {
    return
  }
  throw $WslRequiredAction
}

function Get-RootfsPath {
  if ($env:BLAME_WSL2_ROOTFS -and (Test-Path $env:BLAME_WSL2_ROOTFS)) {
    return $env:BLAME_WSL2_ROOTFS
  }
  $packagedRootfs = Join-Path $RuntimeHome "rootfs\BlameRuntime-rootfs.tar"
  if (Test-Path $packagedRootfs) {
    return $packagedRootfs
  }
  $packagedCompressedRootfs = Join-Path $RuntimeHome "rootfs\BlameRuntime-rootfs.tar.gz"
  if (Test-Path $packagedCompressedRootfs) {
    return $packagedCompressedRootfs
  }
  Get-CachedRootfsPath
}

function Get-CachedRootfsPath {
  $spec = Get-RootfsSpec
  $cacheRoot = Get-CacheRoot
  $fileName = Split-Path $spec.url -Leaf
  $rootfs = Join-Path $cacheRoot $fileName
  if (Test-Path $rootfs) {
    return $rootfs
  }
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
  $download = "$rootfs.download"
  if (Test-Path $download) {
    Remove-Item -Force $download
  }
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $download
    Move-Item -Force $download $rootfs
    return $rootfs
  } catch {
    if (Test-Path $download) {
      Remove-Item -Force $download
    }
    throw $RootfsAction
  }
}

function Get-RootfsSpec {
  $architecture = Get-RuntimeArchitecture
  $spec = $Manifest.rootfs.$architecture
  if ($null -eq $spec -or -not $spec.url) {
    throw "BlameRuntime does not provide a WSL2 rootfs for $architecture."
  }
  $spec
}

function Get-RuntimeArchitecture {
  $architecture = $env:PROCESSOR_ARCHITECTURE
  if ($architecture -eq "ARM64") {
    return "arm64"
  }
  "amd64"
}

function Get-CacheRoot {
  $localAppData = $env:LOCALAPPDATA
  if (-not $localAppData) {
    $localAppData = [System.IO.Path]::GetTempPath()
  }
  Join-Path $localAppData "Blame\runtime\cache"
}

function Ensure-Distro {
  Assert-WslReady
  if (Test-DistroPresent) {
    return
  }
  $rootfs = Get-RootfsPath
  if (-not $rootfs) {
    throw $RootfsAction
  }
  $installRoot = Join-Path $env:LOCALAPPDATA "Blame\runtime\wsl\$DistroName"
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  $result = Invoke-WslHost -WslArgs @("--import", $DistroName, $installRoot, $rootfs, "--version", "2")
  if ($result.Code -ne 0) {
    throw $result.Output
  }
}

function Invoke-Provisioner {
  $script = Join-Path $PSScriptRoot "provision-blame-runtime.sh"
  $content = Get-Content $script -Raw
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo.FileName = "wsl.exe"
  $process.StartInfo.Arguments = Join-Arguments @("-d", $DistroName, "-u", "root", "--", "sh", "-s", "--", $RuntimeVersion)
  $process.StartInfo.RedirectStandardInput = $true
  $process.StartInfo.RedirectStandardOutput = $false
  $process.StartInfo.RedirectStandardError = $false
  $process.StartInfo.UseShellExecute = $false
  $process.Start() | Out-Null
  $process.StandardInput.Write($content)
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "BlameRuntime provisioning failed."
  }
}

function Join-Arguments {
  param([string[]]$Items)
  ($Items | ForEach-Object { Quote-Argument $_ }) -join " "
}

function Quote-Argument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  '"' + ($Value -replace '"', '\"') + '"'
}

function Ensure-Runtime {
  Ensure-Distro
  Invoke-Provisioner
  Get-RuntimeStatus
}

function Reset-Runtime {
  Assert-WslReady
  if (Test-DistroPresent) {
    Invoke-WslHost -WslArgs @("--unregister", $DistroName) | Out-Null
  }
  Ensure-Runtime
}

function Uninstall-Runtime {
  Assert-WslReady
  if (Test-DistroPresent) {
    Invoke-WslHost -WslArgs @("--unregister", $DistroName) | Out-Null
  }
  Get-RuntimeStatus
}

function Invoke-RuntimeCommand {
  param([string[]]$CommandArgs)
  if (-not (Test-DistroPresent)) {
    throw "BlameRuntime is not installed."
  }
  $user = "blame"
  if ($CommandArgs[0] -eq "root") {
    if ($CommandArgs.Count -lt 2) {
      throw "Missing runtime command."
    }
    $CommandArgs = $CommandArgs[1..($CommandArgs.Count - 1)]
    $user = "root"
  }
  if ($CommandArgs[0] -eq "agent") {
    if ($CommandArgs.Count -gt 1) {
      $CommandArgs = @("blame-runtime-agent") + $CommandArgs[1..($CommandArgs.Count - 1)]
    } else {
      $CommandArgs = @("blame-runtime-agent")
    }
    $user = "root"
  }
  $usesContainerRuntime = Test-ContainerRuntimeCommand $CommandArgs
  if ($usesContainerRuntime) {
    $user = "root"
  }
  if ($usesContainerRuntime) {
    Ensure-ContainerdRunning
  }
  & wsl.exe -d $DistroName -u $user -- @CommandArgs
  exit $LASTEXITCODE
}

if ($args.Count -eq 0) {
  Get-RuntimeStatus
  exit 0
}

switch ($args[0]) {
  "--version" {
    "blame-wsl2-runtime $RuntimeVersion"
  }
  "status" {
    Get-RuntimeStatus
  }
  "ensure" {
    Ensure-Runtime
  }
  "repair" {
    Ensure-Runtime
  }
  "reset" {
    Reset-Runtime
  }
  "uninstall" {
    Uninstall-Runtime
  }
  default {
    Invoke-RuntimeCommand $args
  }
}
