---
title: Building Laravel Images with Paketo Buildpacks
description: Deprecated — building Laravel images with Cloud Native Buildpacks (archived)
---

> **Archived**: This page covers the deprecated Paketo buildpack approach. The current recommendation is to use a [Containerfile](/images/containerfile/) checked into your project root and build via OpenShift's Git-based Deployments feature.

# Building Laravel Images with Paketo Buildpacks

Instead of writing a Containerfile by hand, you can use **Cloud Native Buildpacks (CNBs)** to build a production-ready Laravel image automatically. Paketo buildpacks detect your stack, install runtimes, and create a runnable container image.

## How it works

Buildpacks inspect your source code, determine what runtimes it needs, and produce a container image. For a Laravel app in this guide:

1. **Node.js buildpack** runs first to install npm dependencies and compile frontend assets
2. **PHP buildpack** runs second to install Composer dependencies and configure the PHP runtime

The order matters: Node should run before PHP so compiled assets are present in the final image.

## Prerequisites

- [`pack` CLI](https://buildpacks.io/docs/tools/pack/) for CNB builds
- **Podman** or **Docker** for local testing and image operations
- A Laravel project with `package.json` and `composer.json` at the repo root
- [Quay robot credentials](/quay/getting-started/#get-robot-credentials)

### Reduce build context with `.dockerignore`

`pack` sends your project directory to the builder. Exclude unnecessary files to speed up builds:

```
node_modules
vendor
.git
.env
database/database.sqlite
```

## Build the image

From your Laravel project root:

```bash
pack build quay.apps.uconn.edu/<org>/dev:latest \
  --builder paketobuildpacks/builder-jammy-base \
  --buildpack paketo-buildpacks/nodejs \
  --buildpack paketo-buildpacks/php
```

| Flag | Purpose |
|---|---|
| `--builder paketobuildpacks/builder-jammy-base` | Ubuntu Jammy builder with Paketo buildpacks |
| `--buildpack paketo-buildpacks/nodejs` | Runs Node.js build for frontend assets |
| `--buildpack paketo-buildpacks/php` | Runs PHP/Composer build for Laravel runtime |

### What happens

1. `pack` detects `package.json` and `composer.json`
2. Node.js buildpack installs dependencies and executes your frontend build
3. PHP buildpack runs Composer install and creates launch process metadata
4. The resulting image is ready to run on OpenShift

## Persist config with `project.toml`

Create a `project.toml` at the root of your Laravel repo so CI jobs do not need repeated build flags.

```toml
[_]

[[build.buildpacks]]
id = "paketo-buildpacks/nodejs"

[[build.buildpacks]]
id = "paketo-buildpacks/php"

[build.env]
BP_NODE_VERSION = "20"
BP_PHP_VERSION = "8.3"
BP_PHP_WEB_DIR = "public"
BP_COMPOSER_INSTALL_OPTIONS = "--no-dev --prefer-install=auto"
NODE_ENV = "production"
```

With this file present, your build command can be:

```bash
pack build quay.apps.uconn.edu/<org>/dev:latest \
  --builder paketobuildpacks/builder-jammy-base \
  --publish
```

## Environment variables

Paketo buildpacks accept build-time environment variables that are prefixed with `BP_` or are conventional tool settings such as `NODE_ENV`, `COMPOSER`, and proxy variables. The table below is the canonical reference for the Laravel-focused build configuration used in this site.

| Variable | Default / Example | Purpose |
|---|---|---|
| `BP_NODE_VERSION` | `20` | Pin the Node.js version used during build |
| `BP_PHP_VERSION` | `8.3` | Pin the PHP version used during build |
| `BP_PHP_WEB_DIR` | `public` | Web root for Laravel; point the PHP web server at the app's `public/` directory |
| `BP_PHP_SERVER` | `php-server` | Choose the PHP web server: `php-server`, `httpd`, or `nginx` |
| `BP_PHP_LIB_DIR` | unset | Add directories to PHP's `include_path` |
| `BP_PHP_NGINX_ENABLE_HTTPS` | `false` | Enable HTTPS in the NGINX server config |
| `BP_PHP_ENABLE_HTTPS_REDIRECT` | `true` | Control HTTP-to-HTTPS redirects for `httpd` and `nginx` |
| `BP_PHP_SERVER_ADMIN` | `admin@localhost` | Override the HTTPD server admin address |
| `BP_COMPOSER_VERSION` | auto | Pin the Composer version used during build |
| `BP_COMPOSER_INSTALL_OPTIONS` | `--no-dev --prefer-install=auto` | Pass additional flags to `composer install` |
| `BP_COMPOSER_INSTALL_GLOBAL` | unset | Pass global install options to Composer |
| `BP_COMPOSER_INSTALL_DEV` | `false` | Include Composer dev dependencies when set to `true` |
| `COMPOSER_VENDOR_DIR` | `vendor` | Override Composer's vendor directory |
| `COMPOSER` | `composer.json` | Point Composer at a different manifest file |
| `COMPOSER_AUTH` | unset | Provide Composer authentication as JSON |
| `NODE_ENV` | `production` | Set production mode for frontend dependency and asset builds |
| `BP_LOG_LEVEL` | unset | Enable debug logging when set to `DEBUG` |
| `http_proxy` / `https_proxy` / `no_proxy` | unset | Configure proxy access for dependency downloads |

Set build-time variables in `project.toml` (`[build.env]`) or directly in your CI pipeline. When this guide mentions buildpack configuration, it should link back to this table.

## PHP extensions

Paketo PHP buildpacks include a default extension set only. If your app depends on additional extensions, they must be explicitly required in `composer.json`.

For example:

```json
"require": {
  "ext-pdo_mysql": "*",
  "ext-mongodb": "*"
}
```

If an extension is required by your app and not declared in `composer.json`, your build may succeed with missing runtime capabilities or fail at dependency resolution.

> Always treat `composer.json` as the source of truth for required PHP extensions.

For the full build-time configuration reference, see the table above.

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
| Buildpack not detected | Missing `package.json`, `composer.json`, or incorrect `project.toml` IDs | Verify project files and IDs (`paketo-buildpacks/nodejs`, `paketo-buildpacks/php`) |
| Node build fails | Missing lockfile or incompatible Node version | Commit `package-lock.json`; set `BP_NODE_VERSION` |
| Composer install fails | Missing `composer.lock`, required PHP extensions not declared, or the wrong Composer flags are set | Commit `composer.lock`; add required `ext-*` entries to `composer.json`; review `BP_COMPOSER_INSTALL_OPTIONS` |
| `pack` cannot push image | Registry auth/network issue | Validate Quay credentials and proxy environment variables |
| Runtime errors for missing extension | Extension used by app but not declared | Add extension as `ext-*` in `composer.json` and rebuild |
