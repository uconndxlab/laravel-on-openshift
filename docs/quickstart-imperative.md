# Quickstart (Imperative Reference)

> This page is the **original imperative quickstart** kept for reference. The recommended approach is the [template-based quickstart](/docs/quickstart), which achieves the same result with a single `oc process` command.

Deploy a Laravel application to OpenShift from scratch, including persistent storage for SQLite, health checks, and automated rollouts.

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

## 4. Deploy on OpenShift

```bash
oc new-app quay.apps.uconn.edu/<org>/dev:latest --name=myapp -n <team>-dev
```

This creates a **Deployment** (manages pods) and a **Service** (stable network endpoint). OpenShift inspects the image and auto-detects port 8080. Verify:

```bash
oc get svc myapp -n <team>-dev -o jsonpath='{.spec.ports[].port}'
# Should print: 8080
```

If the port is missing, recreate with `oc new-app --name=myapp --image=... --port=8080 -n <team>-dev`.

> The Deployment and Service are the building blocks: the Deployment ensures your app stays running, and the Service gives it a fixed IP and DNS name inside the cluster.

The pod will start but won't fully work yet — it needs persistent storage, environment variables, and health checks.

## 5. Create persistent storage

Create two PersistentVolumeClaims — one for the SQLite database and one for Laravel's `storage/` directory:

```bash
cat <<EOF | oc apply -f - -n <team>-dev
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-sqlite
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-storage
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
EOF
```

## 6. Mount storage in the deployment

Attach the PVCs to your deployment:

```bash
oc set volume deployment/myapp --add --name=sqlite \
  --type=persistentVolumeClaim --claim-name=laravel-sqlite \
  --mount-path=/var/www/html/database -n <team>-dev

oc set volume deployment/myapp --add --name=laravel-storage \
  --type=persistentVolumeClaim --claim-name=laravel-storage \
  --mount-path=/var/www/html/storage -n <team>-dev
```

When a PVC is first mounted, it's empty. An **init container** runs before the main app to set up the directory structure:

```bash
oc patch deployment/myapp --type=strategic -p='
{
  "spec": {
    "template": {
      "spec": {
        "initContainers": [
          {
            "name": "init-storage",
            "image": "quay.apps.uconn.edu/<org>/dev:latest",
            "command": [
              "sh", "-c",
              "mkdir -p storage/app/public storage/framework/cache storage/framework/views storage/framework/sessions storage/logs && chmod -R 775 storage && touch database/database.sqlite && php artisan storage:link || true"
            ],
            "volumeMounts": [
              {"name": "sqlite", "mountPath": "/var/www/html/database"},
              {"name": "laravel-storage", "mountPath": "/var/www/html/storage"}
            ]
          }
        ]
      }
    }
  }
}' -n <team>-dev
```

Init containers run once, complete, and exit before the main container starts. This one creates the directories Laravel expects, sets permissions, creates the SQLite file, and links `public/storage` to `storage/app/public`.

> **SQLite + replicas**: SQLite cannot handle concurrent writes from multiple pods. Keep replicas at 1: `oc scale deployment/myapp --replicas=1 -n <team>-dev`. See the [persistent storage guide](guides/persistent-storage.md#sqlite-and-replicas) for more.

## 7. Add health checks

OpenShift uses **probes** to know when your app is alive and ready to serve traffic:

```bash
oc set probe deployment/myapp --liveness --get-url=http://:8080/ -n <team>-dev
oc set probe deployment/myapp --readiness --get-url=http://:8080/ -n <team>-dev
```

- **Liveness**: if the app crashes or deadlocks, OpenShift restarts the pod
- **Readiness**: if the app isn't responding, OpenShift stops sending traffic until it recovers

For a more robust setup, add a dedicated `/health` endpoint to your Laravel app that also checks database connectivity.

## 8. Set resource limits

Prevent a pod from consuming all cluster resources:

```bash
oc set resources deployment/myapp --limits=cpu=500m,memory=512Mi \
  --requests=cpu=200m,memory=256Mi -n <team>-dev
```

- **Requests**: minimum guaranteed resources
- **Limits**: maximum allowed before throttling/OOM

Start conservative and adjust based on `oc adm top pods` or `oc describe pod` metrics.

## 9. Configure environment variables

Sensitive values like `APP_KEY` should use a **Secret**, not a ConfigMap. General configuration goes in a ConfigMap.

Create the Secret for secrets:

```bash
oc create secret generic laravel-secrets \
  --from-literal=APP_KEY=$(php artisan key:generate --show) \
  -n <team>-dev
```

Create the ConfigMap for general config:

```bash
oc create configmap laravel-env \
  --from-literal=APP_ENV=production \
  --from-literal=APP_DEBUG=false \
  --from-literal=APP_URL=https://<your-route> \
  --from-literal=DB_CONNECTION=sqlite \
  --from-literal=LOG_CHANNEL=stderr \
  --from-literal=SESSION_DRIVER=cookie \
  -n <team>-dev
```

Attach both to the deployment:

```bash
oc set env deployment/myapp --from=secret/laravel-secrets -n <team>-dev
oc set env deployment/myapp --from=configmap/laravel-env -n <team>-dev
```

> `LOG_CHANNEL=stderr` sends Laravel logs to stderr so they appear in `oc logs`. The default `stack` channel writes to a file on disk, which you'd need to mount — stderr is simpler in containers.

If you don't know the Route URL yet, set `APP_URL` after exposing the route (step 10), then run `oc set env deployment/myapp --from=configmap/laravel-env --overwrite -n <team>-dev`.

## 10. Expose the route

```bash
oc create route edge myapp --service=myapp -n <team>-dev
```

This creates a public HTTPS URL for your app. Edge termination means TLS is handled at the router, with plain HTTP inside the cluster.

Get the URL:

```bash
oc get route myapp -n <team>-dev -o jsonpath='https://{.spec.host}{"\n"}'
```

> The quickstart uses `edge` TLS. If you need passthrough or re-encrypt, use `oc create route passthrough` or `oc create route reencrypt` instead.

## 11. Check the deployment

```bash
# Watch the pod come up
oc get pods -n <team>-dev --watch
```

Once the pod is `Running` and `READY` shows `1/1`:

```bash
# View the route
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

Then visit http://localhost:8080 in your browser. Useful for testing features that aren't exposed via the Route or for debugging authentication flows.

### Rolling back a bad deploy

If a new image causes problems:

```bash
oc rollout undo deployment/myapp -n <team>-dev
```

This reverts to the previous revision. List all revisions with `oc rollout history deployment/myapp -n <team>-dev`.

## 12. Promote to test and prod

Each environment (dev, test, prod) lives in its own namespace. The promotion process is:

1. Re-tag the image in Quay for the target environment
2. Deploy in the target namespace
3. Create environment-specific secrets (each env needs its own `APP_KEY`)
4. Repeat the storage, probes, and resource setup

```bash
# 1. Re-tag in Quay
podman pull quay.apps.uconn.edu/<org>/dev:latest
podman tag quay.apps.uconn.edu/<org>/dev:latest quay.apps.uconn.edu/<org>/test:latest
podman push quay.apps.uconn.edu/<org>/test:latest

# 2. Deploy in test namespace
oc new-app quay.apps.uconn.edu/<org>/test:latest --name=myapp -n <team>-test

# 3. Create environment-specific secrets and config
oc create secret generic laravel-secrets \
  --from-literal=APP_KEY=$(php artisan key:generate --show) \
  -n <team>-test

oc create configmap laravel-env \
  --from-literal=APP_ENV=testing \
  --from-literal=APP_DEBUG=false \
  --from-literal=APP_URL=https://myapp-test.apps.uconn.edu \
  --from-literal=DB_CONNECTION=sqlite \
  --from-literal=LOG_CHANNEL=stderr \
  -n <team>-test
```

Then repeat steps 5–11 in the target namespace (PVCs, volumes, init container, probes, resources, route, verify).

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

- Learn more about [building images with Paketo buildpacks](images/paketo-buildpack.md) (build configuration and extension requirements)
- Set up [automated deployments with Tekton](ci-cd/automated-buildpack-deploy.md) so every `git push` triggers a build and rollout
- Read about [persistent storage options](guides/persistent-storage.md) including backup strategies and MySQL migration
- Explore [production patterns](guides/production-patterns.md) for queue workers, scheduled tasks, and blue-green deployments
