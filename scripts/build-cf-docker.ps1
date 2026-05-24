$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$projectPath = $projectRoot.Path

docker run --rm `
  -v "${projectPath}:/app" `
  -v aether-router-node-modules:/app/node_modules `
  -w /app `
  node:22-bookworm `
  bash -lc "npm ci && npx opennextjs-cloudflare build"
