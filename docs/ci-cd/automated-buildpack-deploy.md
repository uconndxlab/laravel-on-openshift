# Automating Buildpack Builds on Git Push

This guide covers a fully in-cluster pipeline using **Tekton** to build your Laravel app with Heroku buildpacks, push it to Quay, and roll out the update on OpenShift — triggered automatically whenever a new commit lands on `main`.

## Conceptual flow

```
git push → GitHub webhook → EventListener → PipelineRun
                                               │
                          ┌────────────────────┤
                          ▼                    ▼
                   pack build --publish    oc set image
                   (buildpack → Quay)      (deploy)
```

## Prerequisites

- **Tekton Pipelines + Tekton Triggers** installed in your OpenShift cluster
- **Quay robot token** with push access to your target repo (`dev`)
- **OpenShift pipeline ServiceAccount** — already set up with `quay-pull-<team>` (see [Quay getting-started](../quay/getting-started.md#find-your-imagepullsecret))
- **GitHub webhook** reachable via an OpenShift Route
- A Laravel project with `package.json` + `composer.json` at the root

## 1. Create the Quay push secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: quay-push-creds
type: Opaque
stringData:
  config.json: |
    {
      "auths": {
        "quay.apps.uconn.edu": {
          "auth": "<base64 of '<org>+dev:<robot_token>'>"
        }
      }
    }
```

The `auth` value is a base64-encoded string of `<org>+dev:<robot_token>` (same format as a Docker `config.json`).

Apply it:

```bash
oc apply -f quay-push-creds.yaml -n <team>-dev
```

## 2. Define the Tekton Tasks

### Build task — clone and `pack build --publish`

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: buildpack-build
spec:
  params:
    - name: GIT_REPO
      type: string
    - name: GIT_REVISION
      type: string
    - name: IMAGE
      type: string
    - name: IMAGE_LATEST
      type: string
      description: Additional tag for :latest
    - name: BUILDER
      type: string
      default: heroku/builder:22
  workspaces:
    - name: source
    - name: dockerconfig
  steps:
    - name: clone
      image: alpine/git:2.45
      script: |
        git clone "$(params.GIT_REPO)" /workspace/source
        cd /workspace/source
        git checkout "$(params.GIT_REVISION)"
    - name: build-and-push
      image: alpine:3.19
      env:
        - name: DOCKER_CONFIG
          value: /workspace/dockerconfig
      script: |
        apk add --no-cache wget
        wget -qO- https://github.com/buildpacks/pack/releases/download/v0.35.1/pack-v0.35.1-linux.tgz \
          | tar xz -C /usr/local/bin pack

        cd /workspace/source
        pack build "$(params.IMAGE)" \
          --tag "$(params.IMAGE_LATEST)" \
          --builder "$(params.BUILDER)" \
          --publish
```

Key details:
- `--publish` builds and pushes directly to the registry — **no Docker daemon needed**, no privileged containers, no SCC changes
- The `dockerconfig` workspace provides Quay credentials via `DOCKER_CONFIG`
- The Node.js and PHP buildpacks are automatically detected from `project.toml` or `package.json` + `composer.json`

### Deploy task — roll out the new image

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: buildpack-deploy
spec:
  params:
    - name: IMAGE
      type: string
    - name: DEPLOYMENT
      type: string
    - name: CONTAINER
      type: string
      default: app
    - name: NAMESPACE
      type: string
  steps:
    - name: deploy
      image: registry.access.redhat.com/ubi8/openshift-cli:latest
      script: |
        oc set image "deployment/$(params.DEPLOYMENT)" \
          "$(params.CONTAINER)=$(params.IMAGE)" \
          -n "$(params.NAMESPACE)"
```

This uses the pipeline ServiceAccount — it already has the permissions needed to update Deployments in the namespace.

## 3. Wire them together in a Pipeline

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: buildpack-pipeline
spec:
  params:
    - name: GIT_REPO
      type: string
    - name: GIT_REVISION
      type: string
    - name: IMAGE_PREFIX
      type: string
      description: e.g. quay.apps.uconn.edu/<org>/dev
    - name: DEPLOYMENT
      type: string
      description: Name of the Deployment to roll out
    - name: CONTAINER
      type: string
      default: app
    - name: NAMESPACE
      type: string
  workspaces:
    - name: source
    - name: dockerconfig
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
      workspaces:
        - name: source
          workspace: source
        - name: dockerconfig
          workspace: dockerconfig
    - name: deploy
      taskRef:
        name: buildpack-deploy
      runAfter: [build]
      params:
        - name: IMAGE
          value: $(params.IMAGE_PREFIX):$(params.GIT_REVISION)
        - name: DEPLOYMENT
          value: $(params.DEPLOYMENT)
        - name: CONTAINER
          value: $(params.CONTAINER)
        - name: NAMESPACE
          value: $(params.NAMESPACE)
```

## 4. Apply the Tasks and Pipeline

```bash
oc apply -f buildpack-build.yaml -f buildpack-deploy.yaml -f buildpack-pipeline.yaml -n <team>-dev
```

## 5. Test with a manual PipelineRun

Before hooking up the webhook, run a manual PipelineRun to make sure everything works:

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: buildpack-deploy-manual-
  namespace: <team>-dev
spec:
  pipelineRef:
    name: buildpack-pipeline
  params:
    - name: GIT_REPO
      value: https://github.com/<org>/<laravel-repo>
    - name: GIT_REVISION
      value: main
    - name: IMAGE_PREFIX
      value: quay.apps.uconn.edu/<org>/dev
    - name: DEPLOYMENT
      value: myapp
    - name: CONTAINER
      value: app
    - name: NAMESPACE
      value: <team>-dev
  workspaces:
    - name: source
      volumeClaimTemplate:
        spec:
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 1Gi
    - name: dockerconfig
      secret:
        secretName: quay-push-creds
```

```bash
oc create -f manual-pipelinerun.yaml -n <team>-dev
oc get pipelineruns -n <team>-dev --watch
```

## 6. Wire up the GitHub webhook with Tekton Triggers

### TriggerBinding — extracts params from the webhook payload

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: github-push-binding
spec:
  params:
    - name: GIT_REPO
      value: $(body.repository.clone_url)
    - name: GIT_REVISION
      value: $(body.after)
```

### TriggerTemplate — creates a PipelineRun

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: buildpack-deploy-template
spec:
  params:
    - name: GIT_REPO
    - name: GIT_REVISION
  resourcetemplates:
    - apiVersion: tekton.dev/v1
      kind: PipelineRun
      metadata:
        generateName: buildpack-deploy-
      spec:
        pipelineRef:
          name: buildpack-pipeline
        params:
          - name: GIT_REPO
            value: $(tt.params.GIT_REPO)
          - name: GIT_REVISION
            value: $(tt.params.GIT_REVISION)
          - name: IMAGE_PREFIX
            value: quay.apps.uconn.edu/<org>/dev
          - name: DEPLOYMENT
            value: myapp
          - name: CONTAINER
            value: app
          - name: NAMESPACE
            value: <team>-dev
        workspaces:
          - name: source
            volumeClaimTemplate:
              spec:
                accessModes: [ReadWriteOnce]
                resources:
                  requests:
                    storage: 1Gi
          - name: dockerconfig
            secret:
              secretName: quay-push-creds
```

### EventListener — receives webhooks

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: github-listener
spec:
  triggers:
    - binding:
        name: github-push-binding
      template:
        name: buildpack-deploy-template
```

### Route — expose the EventListener to the internet

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: el-github-listener
spec:
  to:
    kind: Service
    name: el-github-listener
  port:
    targetPort: http-listener
  tls:
    termination: edge
```

### Apply the Triggers resources

```bash
oc apply -f github-push-binding.yaml -f buildpack-deploy-template.yaml \
  -f github-listener.yaml -f github-listener-route.yaml -n <team>-dev

# Get the webhook URL
oc get route el-github-listener -n <team>-dev -o jsonpath='https://{.spec.host}'
```

## 7. Configure the GitHub webhook

1. Go to your GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: paste the Route URL from above
3. **Content type**: `application/json`
4. **Secret**: (optional) add a secret token for extra security
5. **Events**: select **Just the push event**
6. **Active**: checked

With the webhook active, every push to `main` will:

1. GitHub sends a POST to the EventListener Route
2. Tekton Triggers creates a PipelineRun
3. The pipeline clones the repo at that commit
4. `pack build --publish` builds a Heroku-buildpack image and pushes it to Quay as `dev:<full-sha>` + `dev:latest`
5. `oc set image` updates the Deployment, triggering a rollout

## Versioning strategy

| Tag | Purpose |
|---|---|
| `dev:<full-sha>` | Immutable, traceable — exactly one build per commit |
| `dev:latest` | Moving pointer — convenience for quick rollbacks or local pulls |

Promote images to `test` and `prod` by re-tagging in Quay:

```bash
podman pull quay.apps.uconn.edu/<org>/dev:abc123def456...
podman tag quay.apps.uconn.edu/<org>/dev:abc123def456... quay.apps.uconn.edu/<org>/test:abc123def456...
podman push quay.apps.uconn.edu/<org>/test:abc123def456...
```

Or automate promotion via a separate Tekton Pipeline triggered on tag or manual approval.

## Adapting to other git providers

| Provider | Webhook format | Notes |
|---|---|---|
| **GitLab** | `$(body.project.git_http_url)` / `$(body.checkout_sha)` | Similar structure; adjust TriggerBinding paths |
| **Bitbucket** | `$(body.repository.links.clone[0].href)` / `$(body.after)` | See `tekton-bitbucket.md` for Quay image patterns |
| **Gitea / self-hosted** | Varies | Create a custom TriggerBinding matching the JSON payload |

The Pipeline itself does not change — only the TriggerBinding and webhook URL differ.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| PipelineRun stuck on `clone` | Git URL requires authentication | Use an SSH secret or a PAT in the clone URL |
| `pack build` fails with auth error | `DOCKER_CONFIG` path wrong or secret missing | Verify `quay-push-creds` contains valid `config.json` |
| `oc set image` fails (403) | pipeline ServiceAccount lacks permissions | Attach `edit` role: `oc policy add-role-to-user edit -z pipeline` |
| Webhook returns 500 | EventListener can't reach TriggerTemplate | Check `oc get eventlistener -n <team>-dev` status |
| Route not accessible from GitHub | Network policy or TLS mismatch | Verify Route is edge-terminated and cluster has external DNS |
