# ArgoCD GitOps

[ArgoCD](https://argo-cd.readthedocs.io/) is a declarative GitOps tool for Kubernetes. It continuously monitors a Git repository and automatically syncs the cluster state to match what's defined in the repo. When you push a change to your app's manifests, ArgoCD applies it without manual `oc apply` commands.

This guide assumes ArgoCD is already installed on the UConn OpenShift cluster.

## How it works

1. Store your app's manifests in a Git repository (the manifests in `templates/` or your own repo)
2. Create an ArgoCD **Application** that points to the repo and path
3. ArgoCD syncs the cluster to match the repo
4. When you update the repo (new image tag, config change), ArgoCD syncs automatically

ArgoCD can consume any of the template formats in this repo:
- **Raw OpenShift Template** — processed by ArgoCD before applying
- **Helm Chart** — ArgoCD has native Helm support
- **Plain YAML** — just apply as-is

## Using the OpenShift Template

Create an ArgoCD Application that references the template file:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/uconn/uconn-openshift-laravel
    targetRevision: main
    path: templates/openshift
    plugin:
      name: openshift-template
  destination:
    server: https://kubernetes.default.svc
    namespace: <team>-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
  parameters:
    - name: APP_NAME
      value: myapp
    - name: NAMESPACE
      value: <team>-dev
    - name: IMAGE
      value: quay.apps.uconn.edu/<org>/dev
    - name: IMAGE_TAG
      value: latest
    - name: APP_KEY
      value: "base64:..."
    - name: APP_URL
      value: https://myapp-<team>-dev.apps.uconn.edu
```

> The `openshift-template` plugin (installed with ArgoCD) processes the template and applies the rendered YAML. If the plugin is not available, you can pre-process locally and commit the rendered YAML instead.

## Using the Helm chart

ArgoCD has built-in Helm support:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/uconn/uconn-openshift-laravel
    targetRevision: main
    path: templates/helm/laravel
    helm:
      parameters:
        - name: appName
          value: myapp
        - name: image.repository
          value: quay.apps.uconn.edu/<org>/dev
        - name: image.tag
          value: latest
        - name: appKey
          value: "base64:..."
        - name: appUrl
          value: https://myapp-<team>-dev.apps.uconn.edu
  destination:
    server: https://kubernetes.default.svc
    namespace: <team>-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## App of Apps pattern

If you manage many Laravel apps, use the **App of Apps** pattern — one root Application that creates child Applications for each app:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: laravel-apps
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/uconn/laravel-apps
    targetRevision: main
    path: apps
  destination:
    server: https://kubernetes.default.svc
    namespace: openshift-gitops
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Where `apps/` contains one file per app:

```yaml
# apps/myapp.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/uconn/laravel-apps
    targetRevision: main
    path: apps/myapp
    helm:
      parameters:
        - name: image.tag
          value: abc123def456...
  destination:
    server: https://kubernetes.default.svc
    namespace: <team>-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## CI/CD integration with ArgoCD

When using ArgoCD, the CI/CD pipeline only needs to **build and push the image** — ArgoCD handles the deployment.

### Tekton pipeline (build only)

The pipeline just builds and pushes, no deploy task needed:

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: buildpack-pipeline
spec:
  params:
    - name: GIT_REPO
    - name: GIT_REVISION
    - name: IMAGE_PREFIX
      description: e.g. quay.apps.uconn.edu/<org>/dev
  tasks:
    - name: build
      taskRef:
        name: buildpack-build
      params:
        - name: GIT_REPO
          value: $(params.GIT_REPO)
        - name: GIT_REVISION
          value: $(params.GIT_REVISION)
        - name: IMAGE
          value: $(params.IMAGE_PREFIX):$(params.GIT_REVISION)
        - name: IMAGE_LATEST
          value: $(params.IMAGE_PREFIX):latest
```

Deployment is handled by ArgoCD automatically. To trigger a sync after a build, you have two options:

1. **Update the image tag in the manifest repo** — push a commit updating the Helm values or template parameters, and ArgoCD will sync
2. **Use ArgoCD Image Updater** — automatically detects new image tags in the registry and updates the Application

## Reference

- [ArgoCD Documentation](https://argo-cd.readthedocs.io/)
- [ArgoCD Image Updater](https://argocd-image-updater.readthedocs.io/)
- Example Application: [`templates/argocd/application.yaml`](https://github.com/uconn/uconn-openshift-laravel/blob/main/templates/argocd/application.yaml)
