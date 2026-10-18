# Installs or upgrades OpenAlpha on Windows from its latest GitHub release:
#   powershell -c "irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex"
# It installs one self-contained openalpha.exe with Bun built in, so nothing else is set up. Your
# data dir and config are never touched; on an upgrade, `openalpha upgrade` moves a background daemon
# onto the new binary.
# Settings, all optional:
#   OPENALPHA_VERSION=v1.2.0     install that release instead of the latest
#   OPENALPHA_INSTALL_DIR=<dir>  where the binary goes (default %USERPROFILE%\.local\bin)
#   OPENALPHA_NO_ONBOARD=1       skip the first-run model setup (also skipped when CI is set)
#   OPENALPHA_NO_MODIFY_PATH=1   leave the user PATH alone and print the folder instead
# Runs inside the caller's session through `iex`, so it never calls `exit`: that would close the
# operator's window. A failure throws, and the catch at the bottom words it.

& {
  $ErrorActionPreference = 'Stop'
  # PowerShell 5.1 redraws its progress bar per chunk, which slows a large download to a crawl.
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 writes with the legacy code page, which turns Vietnamese into question marks.
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $Repository = 'alex2loop/openalpha'
  $Command = 'openalpha'
  $InstallDir = if ($env:OPENALPHA_INSTALL_DIR) { $env:OPENALPHA_INSTALL_DIR } else { Join-Path $HOME '.local\bin' }
  $Target = Join-Path $InstallDir "$Command.exe"
  $UseVietnamese = (Get-Culture).Name -like 'vi*'

  # Say <english> <vietnamese>
  function Say([string]$En, [string]$Vi) {
    if ($UseVietnamese) { Write-Host $Vi } else { Write-Host $En }
  }

  function Fail([string]$En, [string]$Vi) {
    throw $(if ($UseVietnamese) { $Vi } else { $En })
  }

  # The machine's processor, not the process's: a PowerShell running under emulation still reads ARM.
  function Get-Architecture {
    switch ((Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture) {
      12 { return 'arm64' }
      9 { return 'x64' }
      default { Fail 'There is no OpenAlpha build for this processor.' 'Chưa có bản OpenAlpha cho bộ xử lý này.' }
    }
  }

  # `releases/latest/download` follows the newest full release without an API call.
  function Get-ReleaseBase {
    if ($env:OPENALPHA_VERSION) {
      $tag = 'v' + $env:OPENALPHA_VERSION.TrimStart('v')
      return "https://github.com/$Repository/releases/download/$tag"
    }
    return "https://github.com/$Repository/releases/latest/download"
  }

  # Downloads next to the target and renames into place, so a cut download never leaves a broken
  # command on PATH. A running openalpha.exe cannot be replaced, but it can be renamed aside.
  function Install-Binary {
    $base = Get-ReleaseBase
    $asset = "$Command-windows-$(Get-Architecture).exe"
    $part = Join-Path $InstallDir ".$Command.download"
    $sums = Join-Path $InstallDir ".$Command.sha256sums"

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    try {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $part
      } catch {
        Fail "I couldn't download OpenAlpha. Run this again in a minute." `
          'Chưa tải được OpenAlpha. Đợi một phút rồi chạy lại nhé.'
      }

      $line = Get-Content $sums | Where-Object { ($_ -split '\s+')[1] -eq $asset } | Select-Object -First 1
      $expected = if ($line) { ($line -split '\s+')[0] } else { '' }
      $actual = (Get-FileHash -Algorithm SHA256 -Path $part).Hash.ToLowerInvariant()

      if ($expected -eq '' -or $actual -ne $expected) {
        Fail "The download doesn't match its checksum, so I didn't install it. Run this again." `
          'Tệp tải về không khớp mã kiểm tra nên tôi chưa cài. Chạy lại nhé.'
      }

      Move-Aside
      Move-Item -Force -Path $part -Destination $Target
    } finally {
      Remove-Item -Force -ErrorAction SilentlyContinue -Path $part, $sums
    }
  }

  # The previous upgrade's leftover is replaced; it is locked only while that version still runs.
  function Move-Aside {
    if (-not (Test-Path $Target)) {
      return
    }

    try {
      Move-Item -Force -Path $Target -Destination "$Target.old"
    } catch {
      Fail "An older openalpha.exe is still running. Close it, then run this again." `
        'Một bản openalpha.exe cũ vẫn đang chạy. Đóng nó rồi chạy lại nhé.'
    }
  }

  # The user PATH is written for new terminals, and this session's PATH too so the command works now.
  function Add-ToPath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ -ne '' })
    $env:Path = "$InstallDir;$env:Path"

    if ($entries | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') }) {
      return
    }

    if ($env:OPENALPHA_NO_MODIFY_PATH) {
      Say "One more thing: add this folder to your PATH: $InstallDir" `
        "Thêm một bước: đưa thư mục này vào PATH: $InstallDir"
      return
    }

    [Environment]::SetEnvironmentVariable('Path', (@($InstallDir) + $entries) -join ';', 'User')
  }

  try {
    $firstInstall = -not (Test-Path $Target)

    Say 'Installing OpenAlpha...' 'Đang cài OpenAlpha...'
    Install-Binary
    Add-ToPath

    # A pinned install must not be pulled past the release it asked for, so it only prints the version.
    if (-not $firstInstall -and -not $env:OPENALPHA_VERSION) {
      & $Target upgrade
    } else {
      & $Target version
    }

    # Left for the operator on an upgrade, in CI, or when asked. A setup that stops prints its own
    # reason, so only a finished or skipped one is summed up here.
    if (-not $firstInstall) {
      Say "All set." "Xong rồi."
      return
    }

    if ($env:CI -or $env:OPENALPHA_NO_ONBOARD) {
      Say "All set. Next, run ``$Command onboard`` to pick your AI model." `
        "Xong rồi. Tiếp theo, chạy ``$Command onboard`` để chọn mô hình AI."
      return
    }

    & $Target onboard

    if ($LASTEXITCODE -eq 0) {
      Say "All set." "Xong rồi."
    }
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}
