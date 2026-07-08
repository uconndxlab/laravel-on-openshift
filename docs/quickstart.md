# Quickstart

Deploy a Laravel application to OpenShift from scratch, including persistent storage for SQLite, health checks, and automated rollouts — using the [OpenShift Template](templates/openshift-templates.md) for a single-command deployment.

> For a step-by-step breakdown of each individual resource, see the [imperative quickstart reference](quickstart-imperative.md).

## Prerequisites

Before starting, ensure you have the following:

### Accounts and access

- **UConn NetID** — for authentication via UConn EntraID
- **OpenShift namespace (project)** — dev, test, and prod namespaces provisioned for your team
- **Quay organization** — team org in `quay.apps.uconn.edu` with `dev`, `test`, `prod` repositories (provisioned by Platform Engineering)
- **Robot account credentials** — username and token for pushing images to Quay (provided by your org admin)

### Tools

| Tool | Purpose | Install |
|---|---|---|
| **Pack CLI** | Build images with Cloud Native Buildpacks (no Dockerfile needed) | [buildpacks.io](https://buildpacks.io/docs/tools/pack/) |
| **Podman** or **Docker** | Push images to Quay | [podman.io](https://podman.io/getting-started/installation) / [docker.com](https://docs.docker.com/get-docker/) |
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

# Create the SQLite database file
touch database/database.sqlite
```

Configure `.env` to use SQLite:

```
DB_CONNECTION=sqlite
```

**Important**: Add the following to your `.gitignore` before committing:

```
database/database.sqlite
.env
```

The SQLite database belongs on its persistent volume in production, and `.env` is for local development only — OpenShift uses Secrets and ConfigMaps instead.

## 2. Create a project.toml for buildpack repeatability

Paketo buildpacks auto-detect your Laravel stack — they install the requested PHP version, run Composer, and compile frontend assets when Node.js is present. No Containerfile needed.

Create `project.toml` at the project root:

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
NODE_ENV = "production"
```

Required PHP extensions must be explicitly declared in `composer.json` using `ext-*` requirements (for example, `"ext-pdo_mysql": "*"`). Paketo PHP buildpacks only provide the default extension set unless your Composer requirements request additional extensions.

See the full [Paketo environment variables reference](images/paketo-buildpack.md#environment-variables) for buildpack configuration options, including Composer overrides like `BP_COMPOSER_INSTALL_OPTIONS`.

Also create a `.dockerignore` so `pack` doesn't send unnecessary files to the build container:

```
node_modules
vendor
.git
.env
database/database.sqlite
```

## 3. Build and publish the image directly to Quay

```bash
pack build quay.apps.uconn.edu/<org>/dev:latest \
  --builder paketobuildpacks/builder-jammy-base \
  --publish
```

This single command:

- Builds the image using Paketo buildpacks (`paketo-buildpacks/nodejs`, then `paketo-buildpacks/php`)
- The resulting image serves Laravel from `/var/www/html/public` on **port 8080**, with PHP-FPM proxied behind Nginx
- Pushes the finished image directly to Quay — no local `podman push` needed

> To test locally first: `pack build myapp:latest --builder paketobuildpacks/builder-jammy-base && docker run -it -p 8080:8080 -e APP_KEY=$(php artisan key:generate --show) myapp:latest`

## 4. Deploy everything with the template

Now deploy all resources at once using the [OpenShift Template](templates/openshift-templates.md):

```bash
oc process -f templates/openshift/laravel-template.yaml \
  -p APP_NAME=myapp \
  -p NAMESPACE=<team>-dev \
  -p IMAGE=quay.apps.uconn.edu/<org>/dev \
  -p IMAGE_TAG=latest \
  -p APP_KEY=$(php artisan key:generate --show) \
  -p APP_URL=https://myapp-<team>-dev.apps.uconn.edu \
  -p DB_CONNECTION=sqlite \
  -p LOG_CHANNEL=stderr \
  | oc apply -f - -n <team>-dev
```

This single command creates all the resources your app needs:

- **Deployment** — with init container, health probes, resource limits, and volume mounts
- **Service** — stable network endpoint on port 8080
- **Route** — public HTTPS URL (edge TLS termination)
- **PersistentVolumeClaims** — SQLite database (1 Gi) and Laravel storage (5 Gi)
- **Secret** — `APP_KEY` and any other sensitive values
- **ConfigMap** — `APP_ENV`, `APP_DEBUG`, `APP_URL`, `DB_CONNECTION`, `LOG_CHANNEL`, `SESSION_DRIVER`

The template uses the same image for the init container and the main app container, sets up the directory structure automatically, and configures survival-guaranteeing probes.

> **SQLite + replicas**: SQLite cannot handle concurrent writes from multiple pods. The template sets `replicas: 1`. See the [persistent storage guide](guides/persistent-storage.md#sqlite-and-replicas) for more.

## 5. Check the deployment

```bash
# Watch the pod come up
oc get pods -n <team>-dev --watch
```

Once the pod is `Running` and `READY` shows `1/1`:

```bash
# Get the application URL
oc get route myapp -n <team>-dev -o jsonpath='https://{.spec.host}{"\n"}'

# Run migrations
oc exec deployment/myapp -- php artisan migrate --force

# Verify volumes
oc exec deployment/myapp -- ls -la /var/www/html/database/database.sqlite

# View logs
oc logs deployment/myapp -n <team>-dev
```

### Local debugging with port forwarding

To access a pod directly from your machine without going through the Route:

```bash
oc port-forward deployment/myapp 8080:8080 -n <team>-dev
```

Then visit http://localhost:8080 in your browser.

### Updating after deploy

To roll out a new image tag:

```bash
oc set image deployment/myapp app=quay.apps.uconn.edu/<org>/dev:new-tag -n <team>-dev
```

### Rolling back a bad deploy

```bash
oc rollout undo deployment/myapp -n <team>-dev
```

List all revisions with `oc rollout history deployment/myapp -n <team>-dev`.

## 6. Promote to test and prod

Each environment (dev, test, prod) lives in its own namespace. Use the same template with environment-specific parameters:

```bash
# 1. Re-tag the image in Quay for the target environment
podman pull quay.apps.uconn.edu/<org>/dev:latest
podman tag quay.apps.uconn.edu/<org>/dev:latest quay.apps.uconn.edu/<org>/test:latest
podman push quay.apps.uconn.edu/<org>/test:latest

# 2. Deploy in test namespace using the template
oc process -f templates/openshift/laravel-template.yaml \
  -p APP_NAME=myapp \
  -p NAMESPACE=<team>-test \
  -p IMAGE=quay.apps.uconn.edu/<org>/test \
  -p APP_KEY=$(php artisan key:generate --show) \
  -p APP_URL=https://myapp-<team>-test.apps.uconn.edu \
  -p APP_ENV=testing \
  -p LOG_CHANNEL=stderr \
  | oc apply -f - -n <team>-test
```

> Each environment must have its **own unique `APP_KEY`**. Never share keys across environments — it's a security risk and can cause encrypted data (sessions, cookies) to be unreadable.

### Validation before promoting to prod

```bash
# Smoke test the test deployment
curl -I https://$(oc get route myapp -n <team>-test -o jsonpath='{.spec.host}')

# Run migrations
oc exec deployment/myapp -n <team>-test -- php artisan migrate --force

# Check logs
oc logs deployment/myapp -n <team>-test
```

## Next steps

- Learn how the [OpenShift Template](templates/openshift-templates.md) works and how to customize it
- Create a reusable [Helm chart](templates/helm.md) for deployments outside of OpenShift
- Set up [ArgoCD GitOps](templates/argocd.md) for automatic, declarative deployments
- Learn more about [building images with Paketo buildpacks](images/paketo-buildpack.md)
- Set up [automated deployments with Tekton](ci-cd/automated-buildpack-deploy.md)
- Read about [persistent storage options](guides/persistent-storage.md) including backup strategies and MySQL migration
- Explore [production patterns](guides/production-patterns.md) for queue workers, scheduled tasks, and blue-green deployments
