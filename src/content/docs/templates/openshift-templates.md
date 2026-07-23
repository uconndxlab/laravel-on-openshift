---
title: OpenShift Templates
description: Use OpenShift Templates to deploy Laravel with a single oc process command
---

[OpenShift Templates](https://docs.openshift.com/container-platform/latest/openshift_images/using-templates.html) are parameterized YAML files that describe a set of Kubernetes/OpenShift objects. With a single `oc process` command you can create a fully configured Laravel app — Deployment, Service, Route, PVCs, ConfigMaps, Secrets, init containers, probes, and resource limits — all at once.

## How it works

1. The template defines **parameters** with default values (app name, image, resource sizes, etc.)
2. `oc process -f template.yaml -p KEY=VALUE` substitutes the parameters and outputs rendered YAML
3. `oc apply -f -` applies the rendered YAML to the cluster

This is equivalent to running all 12 steps of the [quickstart](/quickstart/) imperatively, but with a single command.

## The template

The template is at `templates/openshift/laravel-template.yaml` in this repo. It creates:

| Resource | Name pattern | Purpose |
|---|---|---|
| Deployment | `${APP_NAME}` | Runs the app with init container, probes, resource limits |
| Service | `${APP_NAME}` | Stable network endpoint on port 8080 |
| Route | `${APP_NAME}` | Public HTTPS URL (edge termination) |
| PVC | `${APP_NAME}-sqlite` | SQLite database storage (1 Gi default) |
| PVC | `${APP_NAME}-storage` | Laravel storage volume (5 Gi default) |
| Secret | `${APP_NAME}-secrets` | `APP_KEY` (sensitive) |
| ConfigMap | `${APP_NAME}-env` | `APP_ENV`, `APP_DEBUG`, `APP_URL`, `DB_CONNECTION`, etc. |

### Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `APP_NAME` | yes | — | Application name (used for all resource names) |
| `NAMESPACE` | yes | — | Target OpenShift namespace |
| `IMAGE` | yes | — | Quay image repository (e.g., `quay.apps.uconn.edu/org/dev`) |
| `IMAGE_TAG` | no | `latest` | Image tag to deploy |
| `APP_KEY` | yes | auto-generated | Laravel `APP_KEY` (32-char base64) |
| `APP_ENV` | no | `production` | Laravel environment |
| `APP_DEBUG` | no | `false` | Debug mode |
| `APP_URL` | yes | — | Public application URL |
| `DB_CONNECTION` | no | `sqlite` | Database driver |
| `LOG_CHANNEL` | no | `stderr` | Log channel |
| `SESSION_DRIVER` | no | `cookie` | Session driver |
| `REPLICAS` | no | `1` | Pod count (keep at 1 for SQLite) |
| `SQLITE_STORAGE_SIZE` | no | `1Gi` | SQLite PVC size |
| `STORAGE_SIZE` | no | `5Gi` | Storage PVC size |
| `CPU_REQUEST` | no | `200m` | Minimum CPU per pod |
| `CPU_LIMIT` | no | `500m` | Maximum CPU per pod |
| `MEMORY_REQUEST` | no | `256Mi` | Minimum memory per pod |
| `MEMORY_LIMIT` | no | `512Mi` | Maximum memory per pod |

## Usage

### Deploy a new app

```bash
oc process -f templates/openshift/laravel-template.yaml \
  -p APP_NAME=myapp \
  -p NAMESPACE=<team>-dev \
  -p IMAGE=quay.apps.uconn.edu/<org>/dev \
  -p APP_KEY=$(php artisan key:generate --show) \
  -p APP_URL=https://myapp-<team>-dev.apps.uconn.edu \
  | oc apply -f - -n <team>-dev
```

After the pod starts, run migrations:

```bash
oc exec deployment/myapp -- php artisan migrate --force
```

### Promote across environments

Use the same template with different parameter values per namespace:

```bash
# Deploy to test
oc process -f templates/openshift/laravel-template.yaml \
  -p APP_NAME=myapp \
  -p NAMESPACE=<team>-test \
  -p IMAGE=quay.apps.uconn.edu/<org>/test \
  -p APP_KEY=$(php artisan key:generate --show) \
  -p APP_URL=https://myapp-<team>-test.apps.uconn.edu \
  -p APP_ENV=testing \
  | oc apply -f - -n <team>-test
```

### Update an existing deployment

To roll out a new image tag, use `oc set image` — the template is for initial setup and environment promotion:

```bash
oc set image deployment/myapp app=quay.apps.uconn.edu/<org>/dev:new-tag -n <team>-dev
```

Or re-process the template with the new tag — Kubernetes will handle the rolling update:

```bash
oc process -f templates/openshift/laravel-template.yaml \
  -p APP_NAME=myapp \
  -p NAMESPACE=<team>-dev \
  -p IMAGE=quay.apps.uconn.edu/<org>/dev \
  -p IMAGE_TAG=new-tag \
  -p APP_KEY=<existing-key> \
  -p APP_URL=https://myapp-<team>-dev.apps.uconn.edu \
  | oc apply -f - -n <team>-dev
```

> PVCs already exist so `oc apply` is a no-op for them. Secrets and ConfigMaps will be updated. The Deployment will trigger a rolling update.

## Using templates in CI/CD (Tekton)

In a Tekton pipeline, the deploy task can use the template instead of `oc set image`:

```yaml
- name: deploy
  image: registry.access.redhat.com/ubi8/openshift-cli:latest
  script: |
    oc process -f https://raw.githubusercontent.com/uconndxlab/laravel-on-openshift/main/templates/openshift/laravel-template.yaml \
      -p APP_NAME=$(params.DEPLOYMENT) \
      -p NAMESPACE=$(params.NAMESPACE) \
      -p IMAGE=$(params.IMAGE_PREFIX) \
      -p IMAGE_TAG=$(params.GIT_REVISION) \
      -p APP_KEY=$(params.APP_KEY) \
      -p APP_URL=https://$(params.DEPLOYMENT)-$(params.NAMESPACE).apps.uconn.edu \
      | oc apply -f - -n $(params.NAMESPACE)
```

See the [CI/CD guide](/ci-cd/automated-deploy/#using-the-openshift-template-in-a-pipeline) for a full example.

## Reference

The full template source is at [`public/templates/openshift/laravel-template.yaml`](https://github.com/uconndxlab/laravel-on-openshift/blob/main/public/templates/openshift/laravel-template.yaml).
