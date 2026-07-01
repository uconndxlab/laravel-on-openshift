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

### Reduce build context with `.dockerignore`

`pack` sends your entire project directory to the build container. Exclude unnecessary files to speed up builds:

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

### Image internals

Understanding what's in the produced image helps when debugging:

| Property | Value |
|---|---|
| **Web server** | Nginx reverse-proxying to PHP-FPM on a Unix socket |
| **Document root** | `/var/www/html/public` — Laravel's `public/` directory |
| **Port** | `8080` |
| **Entrypoint** | Heroku's boot script (`heroku-php-nginx`) |
| **Working directory** | `/var/www/html` |
| **PHP-FPM config** | Managed by the buildpack; customize via `heroku-php.ini` |
| **Nginx config** | Auto-generated; see [customization below](#customizing-nginx) |

The mount paths used for PVCs (`/var/www/html/database`, `/var/www/html/storage`) match this working directory.

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

## PHP extensions

The Heroku PHP buildpack includes many common extensions by default:

`bcmath`, `bz2`, `ctype`, `curl`, `exif`, `fileinfo`, `gd`, `gmp`, `iconv`, `imagick`, `intl`, `mbstring`, `mysqli`, `mysqlnd`, `openssl`, `pcntl`, `pdo`, `pdo_mysql`, `pdo_pgsql`, `pdo_sqlite`, `pgsql`, `phar`, `posix`, `random`, `readline`, `redis`, `session`, `simplexml`, `sockets`, `sqlite3`, `tokenizer`, `xml`, `xmlwriter`, `zip`, `zlib`

> `pdo_sqlite` and `sqlite3` are included by default — no extra configuration needed for SQLite.

### Adding custom extensions

If your app needs an extension not in the default list, add it to `composer.json`:

```json
"require": {
    "ext-mongodb": "*"
}
```

The buildpack will attempt to install it. You can also create a `heroku-php.ini` at the project root to set PHP configuration values:

```ini
memory_limit = 256M
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 60
```

### Customizing Nginx

The buildpack auto-generates an Nginx config that serves Laravel from `/var/www/html/public` with proper `try_files` rules for front-controller routing. In most cases this works without modification.

To override the Nginx config, create an `nginx.conf` in your project root and add a `Procfile`:

```
web: heroku-php-nginx -C nginx.conf /var/www/html/public
```

A common customization is increasing the upload size:

```nginx
server {
    listen 8080;
    root /var/www/html/public;
    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/tmp/heroku.fcgi;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

> Nginx does **not** read `.htaccess` files. Any rewrite rules you previously used in `.htaccess` must be converted to Nginx `location` directives.

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
