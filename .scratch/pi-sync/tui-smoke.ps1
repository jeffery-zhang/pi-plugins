$ErrorActionPreference = 'Stop'
$workspace = 'D:/Personal/pi-plugins'
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tuiRoot = Join-Path $temporaryBase ('pi-sync-tui-' + [guid]::NewGuid().ToString())
if (-not $tuiRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated TUI directory' }
$agentDirectory = Join-Path $tuiRoot 'agent'
$isolatedHome = Join-Path $tuiRoot 'home'
$repository = Join-Path $tuiRoot 'remote.git'
New-Item -ItemType Directory -Path $agentDirectory, $isolatedHome | Out-Null
& git init --bare --initial-branch=main $repository
if ($LASTEXITCODE -ne 0) { throw 'Test repository initialization failed' }
$settings = @{ defaultProvider = 'fixture'; defaultModel = 'fixture-model'; quietStartup = $true; tuiMode = 'regular'; lastChangelogVersion = '1.4.0' }
$models = @{ providers = @{ fixture = @{ api = 'openai-completions'; baseUrl = 'http://127.0.0.1:1/v1'; apiKey = '$PI_SYNC_FIXTURE_KEY'; models = @(@{ id = 'fixture-model'; name = 'TUI fixture'; contextWindow = 32000; maxTokens = 1024 }) } } }
$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $agentDirectory 'settings.json') -Encoding utf8
$models | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $agentDirectory 'models.json') -Encoding utf8
@{ root = $tuiRoot; agentDir = $agentDirectory; repository = $repository } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace '.scratch/pi-sync/tui-fixture.json') -Encoding utf8
foreach ($entry in @(Get-ChildItem Env: | Where-Object Name -Match 'KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL')) { Remove-Item -LiteralPath ('Env:' + $entry.Name) }
$env:PI_CODING_AGENT_DIR = $agentDirectory
$env:PI_CODING_AGENT_SESSION_DIR = Join-Path $tuiRoot 'sessions'
$env:PI_OFFLINE = '1'
$env:PI_SYNC_FIXTURE_KEY = 'fixture-not-a-real-key'
$env:HOME = $isolatedHome
$env:USERPROFILE = $isolatedHome
$env:GIT_CONFIG_GLOBAL = Join-Path $isolatedHome 'gitconfig'
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_AUTHOR_NAME = 'Pi Sync TUI Fixture'
$env:GIT_AUTHOR_EMAIL = 'pi-sync@example.invalid'
$env:GIT_COMMITTER_NAME = 'Pi Sync TUI Fixture'
$env:GIT_COMMITTER_EMAIL = 'pi-sync@example.invalid'
$env:NPM_CONFIG_REGISTRY = 'https://registry.npmmirror.com'
Set-Location -LiteralPath $tuiRoot
& pi --offline --no-mcp --no-extensions --no-skills --no-session -e (Join-Path $workspace 'packages/sync')
if ($LASTEXITCODE -ne 0) { throw 'Pi TUI failed' }
& git --git-dir $repository rev-parse main
if ($LASTEXITCODE -ne 0) { throw 'TUI did not save a snapshot' }
if (-not (Test-Path -LiteralPath (Join-Path $agentDirectory 'sync/last-restore.json'))) { throw 'TUI did not complete a restore' }
Write-Output 'PI_SYNC_TUI_SMOKE_PASS'
