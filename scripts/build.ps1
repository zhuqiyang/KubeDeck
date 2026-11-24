param(
    [string]$Output = "..\work\kubedeck-linux-amd64"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Push-Location "$Root\frontend"
try {
    npm install
    npm run build
} finally {
    Pop-Location
}

Push-Location $Root
try {
    $env:GOOS = "linux"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "0"
    go build -trimpath -ldflags "-s -w" -o $Output .\backend
} finally {
    Pop-Location
}
