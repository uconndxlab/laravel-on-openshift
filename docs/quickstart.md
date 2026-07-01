# Quickstart

Deploy a Laravel application to OpenShift in about 10 steps.

## Prerequisites

Before starting, ensure you have the following:

### Accounts and access

- **UConn NetID** — for authentication via UConn EntraID
- **OpenShift namespace** — dev, test, and prod namespaces provisioned for your team
- **Quay organization** — team org in `quay.apps.uconn.edu` with `dev`, `test`, `prod` repositories (provisioned by Platform Engineering)
- **Robot account credentials** — username and token for pushing images to Quay (provided by your org admin)

### Tools

| Tool | Purpose | Install |
|---|---|---|
| **Podman** or **Docker** | Build and push container images | [podman.io](https://podman.io/getting-started/installation) / [docker.com](https://docs.docker.com/get-docker/) |
| **OpenShift CLI (`oc`)** | Interact with the cluster | [OpenShift docs](https://docs.openshift.com/container-platform/latest/cli_reference/openshift_cli/getting-started-cli.html) |
| **Git** | Version control | [git-scm.com](https://git-scm.com/) |
| **PHP + Composer** | Laravel development | [php.net](https://www.php.net/downloads) / [getcomposer.org](https://getcomposer.org/) |

### Verify access

```bash
# Log in to OpenShift
oc login --server=https://api.openshift.uconn.edu

# Verify your namespaces
oc get projects

# Log in to Quay
podman login quay.apps.uconn.edu
```

### Service accounts and secrets

Your namespace is provisioned with:

- **imagePullSecret** (`quay-pull-<team>`) — attached to `default`, `builder`, `deployer`, and `pipeline` ServiceAccounts
- **Pipeline ServiceAccount** — includes the Quay pull secret for Tekton workloads

If any of these are missing, contact Platform Engineering.

---

## 1. Prepare your Laravel application

```bash
composer create-project laravel/laravel myapp
cd myapp
```

## 2. Create a Containerfile

```dockerfile
FROM php:8.3-fpm-alpine AS base

RUN docker-php-ext-install pdo_mysql

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
COPY . /var/www/html
WORKDIR /var/www/html

RUN composer install --no-dev --optimize-autoloader

FROM nginx:alpine AS web
COPY --from=base /var/www/html /var/www/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

## 3. Build and tag the image

```bash
podman build -t myapp:1.0 .
```

## 4. Log in to Quay

```bash
podman login quay.apps.uconn.edu
# Username: <org>+dev
# Password: <robot_token>
```

## 5. Push to Quay

```bash
podman tag myapp:1.0 quay.apps.uconn.edu/<org>/dev:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/dev:myapp_v1.0
```

## 6. Deploy on OpenShift

```bash
oc new-app quay.apps.uconn.edu/<org>/dev:myapp_v1.0 --name=myapp -n <team>-dev
oc expose service/myapp -n <team>-dev
```

## 7. Check the deployment

```bash
oc get pods -n <team>-dev
oc get route -n <team>-dev
```

## 8. Configure environment variables

```bash
oc create configmap laravel-env --from-literal=APP_ENV=production \
  --from-literal=APP_DEBUG=false \
  --from-literal=DB_CONNECTION=mysql -n <team>-dev
oc set env deployment/myapp --from=configmap/laravel-env -n <team>-dev
```

## 9. Promote to test and prod

```bash
podman tag myapp:1.0 quay.apps.uconn.edu/<org>/test:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/test:myapp_v1.0

podman tag myapp:1.0 quay.apps.uconn.edu/<org>/prod:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/prod:myapp_v1.0
```

Then update the Deployment image in each namespace.
