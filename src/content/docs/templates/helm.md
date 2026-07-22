---
title: Helm Charts
description: Deploy Laravel on OpenShift using a Helm chart
---

[Helm](https://helm.sh/) is the Kubernetes package manager. A Helm chart packages all the YAML manifests for your application into a versioned, reusable template with configurable values.

This repo provides a Helm chart at `templates/helm/laravel/` that deploys the same Laravel configuration as the [OpenShift Template](/templates/openshift-templates/) — Deployment, Service, Route, PVCs, ConfigMap, Secret, init container, probes, and resource limits — but with the flexibility of Helm's `values.yaml` and `--set` overrides.

## Chart structure

```
templates/helm/laravel/
├── Chart.yaml                # Chart metadata
├── values.yaml               # Default configuration values
├── .helmignore               # Patterns to exclude from the chart
└── templates/
    ├── _helpers.tpl          # Named template helpers
    ├── deployment.yaml       # Deployment with init container, probes
    ├── service.yaml          # Service on port 8080
    ├── route.yaml            # OpenShift Route (edge TLS)
    ├── pvc.yaml              # SQLite + storage PVCs
    ├── configmap.yaml        # Laravel environment config
    ├── secret.yaml           # APP_KEY secret
    └── NOTES.txt             # Post-install usage notes
```

## Usage

### Prerequisites

- [Helm CLI](https://helm.sh/docs/intro/install/) v3+
- Access to your OpenShift cluster (`oc login`)

### Deploy a new app

```bash
helm upgrade --install myapp ./templates/helm/laravel \
  --namespace <team>-dev \
  --create-namespace \
  --set appName=myapp \
  --set image.repository=quay.apps.uconn.edu/<org>/dev \
  --set image.tag=latest \
  --set appKey=$(php artisan key:generate --show) \
  --set appUrl=https://myapp-<team>-dev.apps.uconn.edu
```

After the pod starts, run migrations:

```bash
oc exec deployment/myapp -- php artisan migrate --force
```

### Customizing via values.yaml

Create a `values-<env>.yaml` file per environment:

```yaml
# values-dev.yaml
appName: myapp
image:
  repository: quay.apps.uconn.edu/<org>/dev
  tag: latest
appKey: "base64:..."
appUrl: https://myapp-dev.apps.uconn.edu
appEnv: production
persistence:
  sqliteSize: 1Gi
  storageSize: 5Gi
resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

```yaml
# values-test.yaml
appName: myapp
image:
  repository: quay.apps.uconn.edu/<org>/test
  tag: latest
appKey: "base64:..."
appUrl: https://myapp-test.apps.uconn.edu
appEnv: testing
```

Then deploy per environment:

```bash
helm upgrade --install myapp ./templates/helm/laravel \
  --namespace <team>-dev \
  --values values-dev.yaml

helm upgrade --install myapp ./templates/helm/laravel \
  --namespace <team>-test \
  --values values-test.yaml
```

### Update an existing deployment

Change the image tag and upgrade:

```bash
helm upgrade --install myapp ./templates/helm/laravel \
  --namespace <team>-dev \
  --set image.tag=new-tag
```

Helm will diff the current state against the new values and apply only the changes (rolling update for the Deployment, no-op for PVCs).

## Using Helm in CI/CD (Tekton)

In a Tekton pipeline, the deploy task can run `helm upgrade`:

```yaml
- name: deploy
  image: alpine/helm:3.14
  script: |
    helm upgrade --install $(params.DEPLOYMENT) ./templates/helm/laravel \
      --namespace $(params.NAMESPACE) \
      --set image.repository=$(params.IMAGE_PREFIX) \
      --set image.tag=$(params.GIT_REVISION) \
      --set appKey=$(params.APP_KEY) \
      --set appUrl=https://$(params.DEPLOYMENT)-$(params.NAMESPACE).apps.uconn.edu
```

> The `alpine/helm` image is a popular minimal Helm image. You can also use `registry.access.redhat.com/ubi8/helm` if you prefer a Red Hat base image.

## Reference

The full chart source is at [`templates/helm/laravel/`](https://github.com/uconndxlab/laravel-on-openshift/tree/main/templates/helm/laravel).
