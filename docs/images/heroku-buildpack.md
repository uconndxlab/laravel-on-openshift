# Building Laravel Images with Heroku Buildpacks

Instead of writing a Containerfile by hand, you can use **Cloud Native Buildpacks (CNBs)** to build a production-ready Laravel image automatically. Heroku's buildpacks detect your stack, install the right runtime, and wire up the web process — no Dockerfile needed.

## How it works

Buildpacks inspect your source code, determine what runtimes it needs, and produce a container image. For a Laravel app this means:

1. **Node.js buildpack** runs first — installs `npm` dependencies and executes `npm run build` (or `heroku-postbuild`) to compile Vite/Webpack assets
2. **PHP buildpack** runs second — installs Composer dependencies, configures PHP-FPM, and sets up the web process

The order matters: Node must run first so compiled assets land on disk before the PHP layer snapshots the filesystem.

## Prerequisites

- [`pack` CLI](https://buildpacks.io/docs/tools/pack/) — the CNB command-line tool (`brew install pack`, or download from GitHub releases)
- **Podman** or **Docker** — for local image storage and pushing to Quay
- A Laravel project with both `package.json` and `composer.json` at the root
- [Quay robot credentials](../quay/getting-started.md#get-robot-credentials) for pushing images

## Build the image

From your Laravel project root:

```bash
pack build quay.apps.uconn.edu/<org>/dev:latest \
  --builder heroku/builder:22 \
  --buildpack heroku/nodejs \
  --buildpack heroku/php
```

| Flag | Purpose |
|---|---|
| `--builder heroku/builder:22` | Ubuntu 22-based builder image containing both buildpacks |
| `--buildpack heroku/nodejs` | Run the Node.js buildpack first (asset compilation) |
| `--buildpack heroku/php` | Run the PHP buildpack second (Composer + web config) |

### What happens

1. `pack` analyses your repo, detects `package.json` (Node) and `composer.json` (PHP)
2. Node buildpack runs `npm ci` and `npm run build` (or `heroku-postbuild`) — produces compiled assets in `public/build/`
3. PHP buildpack runs `composer install --no-dev` and configures the web process
4. The resulting image starts PHP-FPM behind an Nginx proxy, served on port 8080

## Persist config with `project.toml`

Create a `project.toml` at the root of your Laravel repo to bake in the buildpack configuration. Then you can run just `pack build . --publish` in CI without repeating flags.

```toml
[_]

[[build.buildpacks]]
id = "heroku/nodejs"

[[build.buildpacks]]
id = "heroku/php"

[build.env]
BP_NODE_VERSION = "20"
BP_PHP_VERSION = "8.3"
NODE_ENV = "production"
```

With this file present, the build command shortens to:

```bash
pack build quay.apps.uconn.edu/<org>/dev:latest \
  --builder heroku/builder:22 \
  --publish
```

The buildpacks are auto-detected from `project.toml` and the environment variables override the Heroku defaults.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `BP_NODE_VERSION` | (auto) | Pin Node.js version, e.g. `"20"` |
| `BP_PHP_VERSION` | (auto) | Pin PHP version, e.g. `"8.3"` |
| `NODE_ENV` | `production` | npm installs production deps; asset build targets production |
| `COMPOSER_INSTALL_FLAGS` | `--no-dev` | Flags passed to `composer install` |
| `BP_COMPOSER_INSTALL_DEV` | `false` | Set to `true` to include dev dependencies |

Set these as environment variables or in `project.toml` under `[build.env]`.

## Push to Quay

```bash
podman login quay.apps.uconn.edu
podman push quay.apps.uconn.edu/<org>/dev:latest
```

## Verify the image

```bash
pack inspect-image quay.apps.uconn.edu/<org>/dev:latest

# Or run it locally to test
docker run -it -p 8080:8080 -e APP_KEY=$(php artisan key:generate --show) quay.apps.uconn.edu/<org>/dev:latest
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Buildpack not detected | Missing or incomplete `scripts.build` or `scripts.heroku-postbuild` in `package.json` | Add a build script: `"heroku-postbuild": "npm run build"` |
| Node build fails | Missing lockfile or incompatible Node version | Commit `package-lock.json`; pin version with `BP_NODE_VERSION` |
| Composer install fails | Missing `composer.lock` or PHP extension constraints | Commit `composer.lock`; pin PHP extension requirements |
| `pack` can't reach the registry | Network / proxy issue | Set `HTTP_PROXY` / `HTTPS_PROXY` env vars |
| Image starts but returns 503 | `APP_KEY` not set (Laravel encryption key) | Set `APP_KEY` env var at deploy time |
