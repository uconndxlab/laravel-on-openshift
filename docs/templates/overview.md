# Deployment Templates Overview

Deploying a Laravel app on OpenShift involves creating a Deployment, Service, Route, PVCs, ConfigMaps, Secrets, init containers, probes, and resource limits — about a dozen distinct steps. Running these steps imperatively every time (or across every app) is repetitive and error-prone.

**Templates** let you capture this entire configuration as reusable, parameterized manifests so every Laravel app gets the same setup with consistent defaults.

## Available approaches

This repo provides three approaches:

| Approach | Tooling required | Best for |
|---|---|---|
| [OpenShift Template](openshift-templates.md) | `oc` only | Quick, reproducible deployments with zero extra tooling |
| [Helm Chart](helm.md) | `helm` CLI | Teams already using Helm, or needing portability beyond OpenShift |
| [ArgoCD GitOps](argocd.md) | ArgoCD installed on cluster | Declarative, auto-synced deployments; managing many apps at scale |

All three produce the same result: a Laravel app running on OpenShift with SQLite persistence, health checks, environment configuration, and resource limits.

## Template repository

The template files live in this repository under `templates/`:

```
templates/
├── openshift/
│   └── laravel-template.yaml     # OpenShift Template (oc process)
├── helm/
│   └── laravel/                  # Helm chart (helm upgrade --install)
└── argocd/
    └── application.yaml          # ArgoCD Application manifest
```

In the future these may be extracted to a dedicated repository (e.g., `uconn-laravel-openshift-templates`) with semantic versioning, consumable via Helm repo, raw URL, or ArgoCD App of Apps.

## Choosing an approach

- **New to templating?** Start with the [OpenShift Template](openshift-templates.md) — it requires no additional tools beyond `oc`.
- **Already use Helm?** Use the [Helm chart](helm.md) — it's more flexible and portable to other Kubernetes clusters.
- **Managing many apps?** Use [ArgoCD](argocd.md) to sync all your Laravel apps from a central Git repository automatically.
