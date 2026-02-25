# PSScriptAnalyzerSettings
# @{
#   ExcludeRules = @('PSUseApprovedVerbs')
# }

$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$toolName = if ($data.toolName) { [string]$data.toolName } else { "" }
$toolArgs = @{}
if ($data.toolArgs) {
    try {
        $toolArgs = $data.toolArgs | ConvertFrom-Json
    } catch {
        $toolArgs = @{}
    }
}

function Test-IsRunInTerminalTool([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    $low = $name.ToLowerInvariant()
    return $low -eq "execute/runinterminal" -or $low.EndsWith("/runinterminal") -or $low.Contains("runinterminal") -or $low -in @("execute", "terminal", "shell", "bash")
}

function Test-IsWatchOrInteractiveCommand([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }
    $low = $command.ToLower()
    if ($low -match "\bplaywright\b" -and ($low -match "(^|\s)--ui(\s|$)" -or $low -match "(^|\s)--debug(\s|$)" -or $low -match "(^|\s)pwdebug=1(\s|$)")) { return $true }
    $watchMarkers = @(
        "dotnet watch",
        "vitest --watch",
        "vitest -w",
        "jest --watch",
        "jest --watchall",
        "npm run watch",
        "pnpm run watch",
        "yarn watch"
    )
    return ($watchMarkers | Where-Object { $low.Contains($_) }).Count -gt 0
}

function Test-IsDotNetTestCommand([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }
    return $command -match "(?i)(^|\s)dotnet(\s|$).*?(^|\s)test(\s|$)"
}

function Test-HasNoRestore([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }
    return $command -match "(?i)(^|\s)--no-restore(\s|$)"
}

function Test-EnvPath([string]$path) {
    $base = [System.IO.Path]::GetFileName($path)
    return $base -like ".env*"
}

function Test-Placeholder([string]$value) {
    $low = $value.ToLower()
    return $low.Contains("changeme") -or $low.Contains("example") -or $low.Contains("your") -or $low.Contains("placeholder") -or $low.Contains("xxxx") -or $low.Contains("todo") -or $low.Contains("sample")
}

function Test-ContainsSecret([string]$content) {
    if ([string]::IsNullOrWhiteSpace($content)) { return $false }
    if ($content.Contains("-----BEGIN") -and $content.Contains("PRIVATE KEY")) { return $true }
    foreach ($line in $content -split "`n") {
        if ($line -match "(?i)\b(api_?key|secret|token|password|access_key|private_key)\b\s*[:=]\s*([^\s#]+)") {
            $value = $Matches[2].Trim('"').Trim("'")
            if ($value.Length -ge 8 -and -not (Test-Placeholder $value)) { return $true }
        }
    }
    return $false
}

function Convert-CommandForLog([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return "" }
    $value = $value -replace "(?i)(authorization:\s*bearer\s+)[^\s]+", '$1***'
    $value = $value -replace "(?i)(token|secret|password|api_?key)\s*[:=]\s*[^\s]+", '$1=***'
    return $value
}

function Get-ToolArgsSummary {
    if ($toolName -in @("edit", "create", "create_file", "edit_file")) {
        $path = $toolArgs.path
        if (-not $path) { $path = $toolArgs.filePath }
        if (-not $path) { $path = $toolArgs.file_path }
        $content = $toolArgs.content
        if (-not $content) { $content = $toolArgs.newCode }
        if ($content -is [System.Collections.IEnumerable] -and -not ($content -is [string])) {
            $content = ($content | ForEach-Object { "$_" }) -join "`n"
        }
        return [ordered]@{ path = $path; contentLength = ($content | Out-String).Length }
    }
    if (Test-IsRunInTerminalTool $toolName) {
        $command = $toolArgs.command
        if (-not $command -and $toolArgs.args) {
            if ($toolArgs.args -is [System.Collections.IEnumerable] -and -not ($toolArgs.args -is [string])) {
                $command = ($toolArgs.args | ForEach-Object { "$_" }) -join " "
            } else {
                $command = [string]$toolArgs.args
            }
        }
        $timeout = $toolArgs.timeout
        $isBackground = $toolArgs.isBackground
        return [ordered]@{ command = (Convert-CommandForLog $command); timeout = $timeout; isBackground = $isBackground }
    }
    $keys = @()
    if ($toolArgs) { $keys = $toolArgs.PSObject.Properties.Name }
    return [ordered]@{ keys = $keys }
}

function Test-ProdCommand([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }
    $low = $command.ToLower()
    $prodMarkers = @("prod", "production", "live", "mainnet")
    $tools = @("ssh", "scp", "kubectl", "terraform", "supabase", "psql", "mysql", "az ", "aws ", "gcloud ")
    return ($prodMarkers | Where-Object { $low.Contains($_) }).Count -gt 0 -and ($tools | Where-Object { $low.Contains($_) }).Count -gt 0
}

function Test-WriteCommand([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }
    $low = $command.ToLower()
    $writeMarkers = @("apply", "destroy", "delete", "drop", "truncate", "update", "insert", "create", "replace", "push", "deploy", "migrate", "alter")
    return ($writeMarkers | Where-Object { $low.Contains($_) }).Count -gt 0
}

function Get-HighRiskCommandReason([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $null }
    $trim = $command.Trim()

    if ($trim -match '^(?i)\s*git\s+push(\s|$)') {
        return "High-risk git command blocked by baseline policy: git push (use a PR workflow instead)."
    }
    if ($trim -match '^(?i)\s*git\s+reset\b' -and $trim -match '(?i)(^|\s)--hard(\s|$)') {
        return "High-risk git command blocked by baseline policy: git reset --hard (can destroy local changes)."
    }
    if ($trim -match '^(?i)\s*git\s+clean\b') {
        $hasForce = $trim -match '(?i)(^|\s)--force(\s|$)|(^|\s)-[a-z]*f[a-z]*(\s|$)'
        $hasDirs = $trim -match '(?i)(^|\s)--directories(\s|$)|(^|\s)-[a-z]*d[a-z]*(\s|$)'
        $hasIgnored = $trim -match '(?i)(^|\s)--ignored(\s|$)|(^|\s)-[a-z]*x[a-z]*(\s|$)'
        if ($hasForce -and $hasDirs -and $hasIgnored) {
            return "High-risk git command blocked by baseline policy: git clean -fdx (or equivalent) (can delete untracked/ignored files)."
        }
    }
    if ($trim -match '^(?i)\s*git\s+(checkout|switch)\b' -and $trim -match '(?i)(^|\s)(-f|--force)(\s|$)') {
        return "High-risk git command blocked by baseline policy: git checkout/switch -f/--force (can discard work)."
    }
    if ($trim -match '^(?i)\s*git\s+rebase\b' -and $trim -match '(?i)(^|\s)(--onto|--interactive|-i)(\s|$)') {
        return "High-risk git command blocked by baseline policy: git rebase --onto/-i (history rewriting and often interactive)."
    }
    if ($trim -match '^(?i)\s*gh\s+repo\s+delete(\s|$)') {
        return "High-risk GitHub CLI command blocked by baseline policy: gh repo delete."
    }

    if ($trim -match '^(?i)\s*(sudo\s+)?rm\s+' -and $trim -match '(?i)(^|\s)-[^\s]*r[^\s]*f[^\s]*(\s|$)' -and $trim -match '(?i)(\s|^)(/|/\*|~|~\/\*)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: rm -rf targeting / or ~."
    }
    if ($trim -match '^(?i)\s*(shutdown|reboot|poweroff|halt)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: shutdown/reboot/poweroff."
    }
    if ($trim -match '^(?i)\s*(sudo\s+)?dd(\s|$)') {
        return "Destructive OS command blocked by baseline policy: dd (raw disk write risk)."
    }
    if ($trim -match '^(?i)\s*(sudo\s+)?mkfs(\.|(\s|$))') {
        return "Destructive OS command blocked by baseline policy: mkfs* (filesystem format risk)."
    }
    if ($trim -match '^(?i)\s*(format|diskpart)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: format/diskpart."
    }
    if ($trim -match '^(?i)\s*(remove-item|rm|ri)\b' -and $trim -match '(?i)(^|\s)-recurse(\s|$)' -and $trim -match '(?i)(^|\s)-force(\s|$)' -and $trim -match '(?i)(\s|^)(c:\\|c:/)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: Remove-Item -Recurse -Force targeting C:\."
    }
    if ($trim -match '^(?i)\s*(rmdir|rd)\b' -and $trim -match '(?i)(^|\s)/s(\s|$)' -and $trim -match '(?i)(^|\s)/q(\s|$)' -and $trim -match '(?i)(\s|^)(c:\\|c:/)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: rmdir/rd /s /q targeting C:\."
    }
    if ($trim -match '^(?i)\s*(del|erase)\b' -and $trim -match '(?i)(^|\s)/s(\s|$)' -and $trim -match '(?i)(^|\s)/q(\s|$)' -and $trim -match '(?i)(\s|^)(c:\\|c:/)(\s|$)') {
        return "Destructive OS command blocked by baseline policy: del/erase /s /q targeting C:\."
    }

    return $null
}

function Get-RequiredEarlyControls {
    $raw = $env:HOOK_EARLY_CONTROLS_REQUIRED
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @("safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation")
    }

    return @($raw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-PrivilegedToolNames {
    $raw = $env:HOOK_PRIVILEGED_TOOLS
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @("execute/runinterminal", "run_in_terminal", "edit", "create", "create_file", "edit_file", "apply_patch")
    }

    return @($raw.Split(",") | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Test-IsPrivilegedTool([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }

    $low = $name.ToLowerInvariant()
    $configured = Get-PrivilegedToolNames
    if ($configured -contains $low) { return $true }

    if ($low.Contains("runinterminal")) { return $true }
    return $false
}

function Get-EarlyControlStatePath([string]$cwd) {
    $configured = $env:HOOK_EARLY_CONTROLS_STATE_FILE
    if ([string]::IsNullOrWhiteSpace($configured)) {
        return Join-Path $cwd ".instructions-output\hooks\early-controls.json"
    }

    if ([System.IO.Path]::IsPathRooted($configured)) {
        return $configured
    }

    return Join-Path $cwd $configured
}

function Test-SafetyTokenParity($state) {
    if (-not $state) {
        return [ordered]@{ ok = $false; detail = 'state_missing' }
    }

    $controlData = $state.controlData
    if (-not $controlData) {
        return [ordered]@{ ok = $false; detail = 'control_data_missing' }
    }

    $safetyToken = [string]$controlData.safetyToken
    $safetyParity = [string]$controlData.safetyTokenParity
    if ([string]::IsNullOrWhiteSpace($safetyToken) -or [string]::IsNullOrWhiteSpace($safetyParity)) {
        return [ordered]@{ ok = $false; detail = 'token_or_parity_missing' }
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $expectedParity = ($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($safetyToken)) | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally {
        $sha256.Dispose()
    }

    if ($expectedParity.ToLowerInvariant() -ne $safetyParity.ToLowerInvariant()) {
        return [ordered]@{ ok = $false; detail = 'token_parity_mismatch' }
    }

    return [ordered]@{ ok = $true; detail = 'token_parity_valid' }
}

function Get-EarlyControlGateResult([string]$cwd, [string[]]$requiredControls) {
    $statePath = Get-EarlyControlStatePath -cwd $cwd
    if (-not (Test-Path $statePath)) {
        return [ordered]@{
            allowed = $false
            statePath = $statePath
            failedControls = @($requiredControls)
            reason = "Privileged action blocked: early controls unavailable (state file missing)."
        }
    }

    $state = $null
    try {
        $state = Get-Content -Raw -Path $statePath | ConvertFrom-Json
    } catch {
        return [ordered]@{
            allowed = $false
            statePath = $statePath
            failedControls = @($requiredControls)
            reason = "Privileged action blocked: early controls unavailable (state file unreadable)."
        }
    }

    if (-not $state) {
        return [ordered]@{
            allowed = $false
            statePath = $statePath
            failedControls = @($requiredControls)
            reason = "Privileged action blocked: early controls unavailable (state missing)."
        }
    }

    $controlsNode = $state.controls
    $failedDetails = @()
    foreach ($controlId in $requiredControls) {
        $controlNode = $null
        if ($controlsNode -and $controlsNode.PSObject.Properties[$controlId]) {
            $controlNode = $controlsNode.PSObject.Properties[$controlId].Value
        }

        $status = $null
        $detail = "missing"
        if ($controlNode) {
            if ($controlNode.PSObject.Properties["status"]) {
                $status = [string]$controlNode.PSObject.Properties["status"].Value
            }
            if ($controlNode.PSObject.Properties["detail"] -and -not [string]::IsNullOrWhiteSpace([string]$controlNode.PSObject.Properties["detail"].Value)) {
                $detail = [string]$controlNode.PSObject.Properties["detail"].Value
            }
        }

        if ($controlId -eq 'safetyTokenParity') {
            $parity = Test-SafetyTokenParity $state
            if (-not $parity.ok) {
                $failedDetails += "${controlId}:$($parity.detail)"
                continue
            }
        }

        if ($status -ne "pass") {
            $failedDetails += "${controlId}:$detail"
        }
    }

    if ($failedDetails.Count -gt 0) {
        return [ordered]@{
            allowed = $false
            statePath = $statePath
            failedControls = $failedDetails
            reason = "Privileged action blocked: early controls not satisfied ($($failedDetails -join ', '))."
        }
    }

    return [ordered]@{
        allowed = $true
        statePath = $statePath
        failedControls = @()
        reason = $null
    }
}

$decision = $null
$reason = $null
$isPrivilegedTool = Test-IsPrivilegedTool $toolName
$requiredEarlyControls = Get-RequiredEarlyControls
$earlyControlGate = $null

if ($isPrivilegedTool) {
    $earlyControlGate = Get-EarlyControlGateResult -cwd $cwd -requiredControls $requiredEarlyControls
    if (-not $earlyControlGate.allowed) {
        $decision = "deny"
        $reason = $earlyControlGate.reason
    }
}

if ($toolName -in @("edit", "create", "create_file", "edit_file")) {
    $path = $toolArgs.path
    if (-not $path) { $path = $toolArgs.filePath }
    if (-not $path) { $path = $toolArgs.file_path }
    $content = $toolArgs.content
    if (-not $content) { $content = $toolArgs.newCode }
    if ($content -is [System.Collections.IEnumerable] -and -not ($content -is [string])) {
        $content = ($content | ForEach-Object { "$_" }) -join "`n"
    }
    if ($path -and (Test-EnvPath $path) -and (Test-ContainsSecret $content)) {
        $decision = "deny"
        $reason = "Secrets are not allowed in .env files. Use GitHub Secrets or local secret storage."
    }
}

if (-not $decision -and (Test-IsRunInTerminalTool $toolName)) {
    $command = $toolArgs.command
    if (-not $command -and $toolArgs.args) {
        if ($toolArgs.args -is [System.Collections.IEnumerable] -and -not ($toolArgs.args -is [string])) {
            $command = ($toolArgs.args | ForEach-Object { "$_" }) -join " "
        } else {
            $command = [string]$toolArgs.args
        }
    }

    # Hard anti-hang enforcement for terminal execution:
    # - timeout must be present and > 0 (no infinite waits)
    # - isBackground must be false (background commands get cancelled / can deadlock agent)
        $timeout = $toolArgs.timeout
        $isBackground = $toolArgs.isBackground

        $timeoutInt = $null
        try { $timeoutInt = [int]$timeout } catch { $timeoutInt = $null }
        $isBackgroundBool = $isBackground -eq $true -or ([string]$isBackground -match '^(?i:true|1|yes)$')

        if ($null -eq $timeoutInt -or $timeoutInt -le 0) {
        $decision = "deny"
        $reason = "Terminal commands must set a non-zero timeout (ms). Infinite waits are not allowed."
        } elseif ($isBackgroundBool) {
        $decision = "deny"
        $reason = "Terminal commands must not run in the background (isBackground=true). Use foreground execution only."
    } elseif (Test-IsWatchOrInteractiveCommand $command) {
        $decision = "deny"
        $reason = "Watch/interactive commands are not allowed in agent runs (they can hang). Use non-interactive equivalents."
    } elseif ($command -match "(?i)\bvitest\b") {
        $hasRun = $command -match "(?i)\bvitest\s+run\b" -or $command -match "(?i)(^|\s)--run(\s|$)"
        if (-not $hasRun) {
            $decision = "deny"
            $reason = "Vitest must be run in non-interactive mode (use vitest run or add --run)."
        }
    } elseif ($command -match "(?i)\bplaywright\b" -and ($command -match "(?i)(^|\s)--ui(\s|$)" -or $command -match "(?i)(^|\s)--debug(\s|$)" -or $command -match "(?i)(^|\s)pwdebug=1(\s|$)")) {
        $decision = "deny"
        $reason = "Playwright UI/debug mode (--ui/--debug, PWDEBUG=1) is interactive and can hang automation runs."
    } elseif (Test-IsDotNetTestCommand $command -and -not (Test-HasNoRestore $command)) {
        $decision = "deny"
        $reason = "dotnet test must include --no-restore to avoid restore prompts/hangs. Build/restore separately if needed."
    } else {
        $highRiskReason = Get-HighRiskCommandReason $command
        if ($highRiskReason) {
            $decision = "deny"
            $reason = $highRiskReason
        }
    }

    if (Test-ProdCommand $command) {
        $allowReadonly = $env:ALLOW_PROD_READONLY -eq "1"
        $approved = $env:PROD_APPROVED -eq "1"
        if (-not ($allowReadonly -and $approved)) {
            $decision = "deny"
            $reason = "Production access requires explicit approval and read-only mode."
        } elseif (Test-WriteCommand $command) {
            $decision = "deny"
            $reason = "Production access is read-only. Write operations require explicit approval."
        }
    }
}

$logEntry = [ordered]@{
    event = "preToolUse"
    timestamp = $data.timestamp
    toolName = $toolName
    isPrivilegedTool = $isPrivilegedTool
    earlyControlsRequired = $requiredEarlyControls
    earlyControlsStatePath = if ($earlyControlGate) { $earlyControlGate.statePath } else { $null }
    earlyControlsFailed = if ($earlyControlGate) { $earlyControlGate.failedControls } else { @() }
    toolArgsSummary = (Get-ToolArgsSummary)
    decision = $decision
    reason = $reason
}
$logEntry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "pre-tool-use.jsonl")

if ($decision -eq "deny") {
    $output = [ordered]@{
        permissionDecision = "deny"
        permissionDecisionReason = $reason
    }
    $output | ConvertTo-Json -Compress
}
