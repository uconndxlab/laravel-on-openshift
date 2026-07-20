# Building Laravel Images with a Containerfile

Place a `Containerfile` (or `Dockerfile`) at the root of your Laravel project to build a production-ready image. OpenShift's Deployments feature can build directly from your Git repository when it detects a Containerfile — no separate CI server needed.

## Multi-stage build strategy

A typical Laravel image needs three stages:

| Stage | Tool | Purpose |
|---|---|---|
| **Frontend** | `node:20-alpine` | Install npm dependencies, compile Vite assets |
| **Vendor** | `composer:2` | Install Composer dependencies, optimize autoloader |
| **Runtime** | `php:8.3-fpm-alpine` | Production PHP-FPM server with Nginx |

## Sample Containerfile

Create `Containerfile` at your project root:

```dockerfile
# Stage 1 — Build frontend assets
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — Install Composer dependencies
FROM composer:2 AS vendor
WORKDIR /app
COPY composer*.json ./
RUN composer install --no-dev --optimize-autoloader

# Stage 3 — Production runtime
FROM php:8.3-fpm-alpine
WORKDIR /var/www/html

# PHP extensions
COPY --from=mlocati/php-extension-installer /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_mysql pdo_sqlite bcmath gd

# Copy application layers
COPY --from=vendor /app/vendor ./vendor
COPY --from=frontend /app/public ./public
COPY . .

# OpenShift compatibility — group-writable storage for random UID
RUN chown -R :www-data storage bootstrap/cache \
    && chmod -R g+w storage bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
```

### Adding a web server

The example above runs PHP-FPM on port 9000. In production you typically front it with Nginx. Add Nginx as an additional build stage or use a separate sidecar container. The example below extends the runtime stage with Nginx:

```dockerfile
# Stage 3 — Production runtime with Nginx
FROM nginx:stable-alpine AS nginx
FROM php:8.3-fpm-alpine

# ... PHP setup as above ...

# Nginx configuration
COPY --from=nginx /etc/nginx /etc/nginx
COPY .docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["sh", "-c", "php-fpm -D && nginx -g 'daemon off;'"]
```

Or keep them separate and use OpenShift's Service mesh — deploy PHP-FPM as one pod and Nginx as another, with a Service connecting them.

## Prerequisites

- **Podman** or **Docker** for local image builds
- A Laravel project with `package.json` and `composer.json` at the repo root
- [Quay robot credentials](../quay/getting-started.md#get-robot-credentials)

### Reduce build context with `.dockerignore`

Prevent unnecessary files from being sent to the build daemon:

```
node_modules
vendor
.git
.env
database/database.sqlite
```

## Build locally

```bash
podman build -t quay.apps.uconn.edu/<org>/dev:latest .
```

Or with Docker:

```bash
docker build -t quay.apps.uconn.edu/<org>/dev:latest -f Containerfile .
```

## Push to Quay

```bash
podman login quay.apps.uconn.edu
podman push quay.apps.uconn.edu/<org>/dev:latest
```

## Test locally

```bash
docker run -it -p 8080:9000 \
  -e APP_KEY=$(php artisan key:generate --show) \
  quay.apps.uconn.edu/<org>/dev:latest
```

If your image runs a web server on port 8080, adjust the port mapping accordingly.

## PHP extensions

Add extensions in the Containerfile using `docker-php-ext-install` (for official PHP images) or `install-php-extensions` (for `mlocati/php-extension-installer`):

```dockerfile
RUN docker-php-ext-install pdo_mysql pdo_sqlite bcmath gd
```

Always declare required extensions in `composer.json` as well using `ext-*` requirements:

```json
"require": {
  "ext-pdo_mysql": "*"
}
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm ci` fails | Missing `package-lock.json` | Commit lockfile or use `npm install` instead |
| Composer install fails | Missing `composer.lock` | Commit lockfile or use `composer install` without `--no-dev` for now |
| Image won't start on OpenShift | Random UID can't write to `storage/` | Ensure `chmod -R g+w storage bootstrap/cache` in Containerfile |
| Port not exposed | Containerfile missing `EXPOSE` | Add `EXPOSE 9000` (or your app port) |
| `install-php-extensions` not found | Missing the mlocati installer | Use `docker-php-ext-install` instead, or add the installer step |
