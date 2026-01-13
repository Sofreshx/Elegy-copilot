$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

$triggerMap = @{
  'aspire-apphost'            = @('AppHost','Aspire AppHost','Aspire orchestration','Aspire')
  'aspire-deployment'         = @('Aspire deploy','AZD','aspire deployment','deploy aspire')
  'aspire-integration-tests'  = @('Aspire test','integration test Aspire','Aspire integration tests','TestContainers')
  'auth'                      = @('auth','authentication','login','firebase','firebase auth','id token','custom claims')
  'cloudflare-storage'        = @('R2','Cloudflare','Cloudflare R2','storage','object storage')
  'code-review'               = @('review','PR review','code review','code quality','peer review')
  'critic'                    = @('use critic mode','challenge this','find weaknesses','what could go wrong','devil''s advocate','poke holes','stress test','5 whys')
  'csharp-expert'              = @('C#','.NET','ASP.NET','DI','async/await','CQRS','xUnit')
  'debug'                     = @('debug','debugging','stack trace','investigate','why failing','error')
  'deployment-compose'        = @('docker','compose','docker compose','container','containers')
  'design'                    = @('design','architecture','diagram','system design')
  'docs'                      = @('documentation','README','docs','write docs')
  'feature-creator'           = @('add endpoint','create feature','backend','CRUD','API endpoint')
  'firebase-auth'             = @('firebase','firebase auth','firebase authentication','id token','verify id token','custom claims','admin sdk','FirebaseAdmin','Bearer token')
  'frontend'                  = @('UI','component','React','Vue','page','frontend')
  'marten-documents'          = @('Marten','document store','IDocumentSession','document DB')
  'marten-events'             = @('event sourcing','Marten events','event stream')
  'marten-linq-querying'      = @('Marten LINQ','NotSupportedException','Include()','child collections','Any','Contains','pagination','Skip','Take','OrderBy','Stats')
  'openai-compatible'         = @('OpenAI','GPT','chat completion','OpenAI-compatible')
  'orleans'                   = @('Orleans','grain','virtual actor')
  'planning-feature'          = @('plan a feature','design a feature','break down requirements','feature plan')
  'planning-refactor'         = @('plan refactor','restructure','refactor plan','technical debt plan')
  'quality-auditor'           = @('audit quality','code smell','quality audit','quality auditor')
  'quality-csharp'            = @('quality-csharp','csharp quality','c# quality','csharp-expert')
  'react-query'               = @('react-query','TanStack','useQuery','useMutation','Query data cannot be undefined','openapi-react-query')
  'refactor'                  = @('refactor','clean up','reorganize','simplify')
  'secrets-auditor'           = @('secrets','credentials','leaked','api key','secret scanning')
  'security'                  = @('security','vulnerability','hardening','secure coding')
  'semantic-kernel-agents'    = @('Semantic Kernel','SK agents','semantic kernel agents')
  'signalr'                   = @('SignalR','real-time','websocket','web sockets')
  'system-cleanup'            = @('system cleanup','archive completed tasks','cleanup tasks')
  'system-drift'              = @('system drift','pattern drift','fix drift')
  'system-editor'             = @('system editor','edit instruction files','edit skills')
  'system-health'             = @('system health','verify system integrity','health check')
  'tech-debt'                 = @('use tech-debt mode','tech debt','code smells','clean up','remove dead code','unused imports','simplify')
  'terraform'                 = @('terraform','infrastructure','IaC','infrastructure as code')
  'testing-dotnet-unit'       = @('xUnit','NSubstitute','Shouldly','AutoFixture','backend unit test','.NET unit test')
  'testing-frontend-unit'     = @('Vitest','Jest','RTL','React Testing Library','component test','frontend unit test')
  'wolverine-core'            = @('Wolverine','message handler','CQRS','command handler')
  'wolverine-http'            = @('Wolverine endpoint','Wolverine API','minimal API','HTTP handler')
}

function Get-SkillNameFromYaml([string]$yaml) {
  $m = [regex]::Match($yaml, '(?m)^name:\s*(.+)\s*$')
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value.Trim().Trim('"',"'")
}

function Find-DescriptionStartIndex([string[]]$lines) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^(?i)description\s*:') { return $i }
  }
  return -1
}

function Extract-DescriptionText([string[]]$yamlLines, [int]$descStartIdx) {
  $line = $yamlLines[$descStartIdx]
  $after = $line.Substring($line.IndexOf(':') + 1).Trim()

  if ($after -match '^"(.*)"$') { return $Matches[1] }
  if ($after -match "^'(.*)'$") { return $Matches[1] }

  if ($after -match '^[>|]') {
    $buf = New-Object System.Collections.Generic.List[string]
    for ($i = $descStartIdx + 1; $i -lt $yamlLines.Count; $i++) {
      $l = $yamlLines[$i]
      if ($l -match '^[^\s].+:') { break }
      $buf.Add(($l -replace '^\s+', ''))
    }
    return ($buf -join ' ').Trim()
  }

  return $after
}

function Replace-DescriptionBlock([string]$yaml, [string]$newDescriptionBlock) {
  $lines = $yaml -split "\r?\n"

  $descIdx = Find-DescriptionStartIndex $lines
  if ($descIdx -lt 0) { return $null }

  $endIdx = $descIdx + 1
  for ($i = $descIdx + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^[^\s].+:') { $endIdx = $i; break }
    $endIdx = $i + 1
  }

  $before = @()
  if ($descIdx -gt 0) { $before = $lines[0..($descIdx-1)] }

  $after = @()
  if ($endIdx -lt $lines.Count) { $after = $lines[$endIdx..($lines.Count-1)] }

  $out = @()
  $out += $before
  $out += ($newDescriptionBlock -split "\r?\n")
  $out += $after

  return ($out -join "`r`n")
}

$targets = @()
$targets += Get-ChildItem -Path (Join-Path $root '.github\skills') -File -Filter '*.md' | Where-Object { $_.Name -ne 'index.md' }
$targets += Get-ChildItem -Path (Join-Path $root '.github\skills') -Recurse -File -Filter 'SKILL.md'
$targets += Get-ChildItem -Path (Join-Path $root '.codex\skills') -File -Filter '*.md' | Where-Object { $_.Name -ne 'index.md' }
$targets += Get-ChildItem -Path (Join-Path $root '.codex\skills') -Recurse -File -Filter 'SKILL.md'

$updated = 0
$skipped = 0
$missingMap = New-Object System.Collections.Generic.HashSet[string]

foreach ($file in $targets) {
  $raw = Get-Content -LiteralPath $file.FullName -Raw

  $fm = [regex]::Match($raw, '(?s)\A---\r?\n(.*?)\r?\n---\r?\n')
  if (-not $fm.Success) { $skipped++; continue }

  $yaml = $fm.Groups[1].Value
  if ($yaml -match 'Triggers on:') { $skipped++; continue }

  $skillName = Get-SkillNameFromYaml $yaml
  if (-not $skillName) { $skipped++; continue }

  if (-not $triggerMap.ContainsKey($skillName)) {
    $missingMap.Add($skillName) | Out-Null
    $skipped++
    continue
  }

  $yamlLines = $yaml -split "\r?\n"
  $descIdx = Find-DescriptionStartIndex $yamlLines
  if ($descIdx -lt 0) { $skipped++; continue }

  $descText = Extract-DescriptionText $yamlLines $descIdx
  if (-not $descText) { $skipped++; continue }

  $descText = ($descText -replace '\s+', ' ').Trim()
  $triggers = $triggerMap[$skillName] | ForEach-Object { '"' + $_ + '"' }
  $triggerLine = '  Triggers on: ' + ($triggers -join ', ') + '.'

  $newDescBlock = @(
    'description: >',
    '  ' + $descText,
    $triggerLine
  ) -join "`r`n"

  $newYaml = Replace-DescriptionBlock $yaml $newDescBlock
  if (-not $newYaml) { $skipped++; continue }

  $newRaw = "---`r`n" + $newYaml + "`r`n---`r`n" + $raw.Substring($fm.Index + $fm.Length)

  if ($newRaw -ne $raw) {
    Set-Content -LiteralPath $file.FullName -Value $newRaw -NoNewline
    $updated++
  } else {
    $skipped++
  }
}

Write-Host "Updated: $updated"
Write-Host "Skipped: $skipped"
if ($missingMap.Count -gt 0) {
  Write-Host "Missing trigger mapping for skill names: $($missingMap.ToArray() -join ', ')"
}
