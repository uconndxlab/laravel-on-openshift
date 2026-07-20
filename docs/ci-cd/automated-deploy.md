# Automating Container Image Builds on Git Push

This guide covers a fully in-cluster pipeline using **Tekton** to clone your Laravel repo, build the image from its `Containerfile` (or `Dockerfile`), push it to Quay, and roll out the update on OpenShift — triggered automatically whenever a new commit lands on `main`.

## Conceptual flow

```
git push → GitHub webhook → EventListener → PipelineRun
                                               │
                          ┌────────────────────┤
                          ▼                    ▼
                   podman/buildah build    oc set image
                   (Containerfile → Quay)  (deploy)
```

## How Tekton works

| Resource | What it does |
|---|---|
| **Task** | A unit of work (e.g., "build image" or "deploy"). Each Task runs as a pod with one or more steps. |
| **Pipeline** | A sequence of Tasks wired together. |
| **PipelineRun** | An instantiation of a Pipeline — "run this Pipeline with these parameters." |
| **TriggerBinding** | Extracts values from a webhook payload (e.g., Git repo URL, commit SHA). |
| **TriggerTemplate** | Creates a PipelineRun from extracted values. |
| **EventListener** | A webhook receiver — fires the binding + template when GitHub posts to it. |

The flow: **git push → GitHub webhook → EventListener → TriggerBinding + TriggerTemplate → PipelineRun → Tasks run → app deploys**

## Prerequisites

- **Tekton Pipelines + Tekton Triggers** installed in your OpenShift cluster
- **Quay robot token** with push access to your target repo (`dev`)
- **OpenShift pipeline ServiceAccount** — already set up with `quay-pull-<team>` (see [Quay getting-started](../quay/getting-started.md#find-your-imagepullsecret))
- **GitHub webhook** reachable via an OpenShift Route
- A Laravel project with a `Containerfile` (or `Dockerfile`) at the root

> **Network policy note**: If your namespace has restrictive network policies, ensure the Tekton pipeline pods can egress to `quay.apps.uconn.edu` (for pushing images) and to your Git provider.

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

The `auth` value is a base64-encoded string of `<org>+dev:<robot_token>`.

Apply it:

```bash
oc apply -f quay-push-creds.yaml -n <team>-dev
```

## 2. Define the Tekton Tasks

### Build task — clone and build the Containerfile

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: container-build
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
    - name: CONTAINERFILE
      type: string
      default: Containerfile
      description: Path relative to repo root
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
      image: quay.io/buildah/stable:v1.36
      env:
        - name: DOCKER_CONFIG
          value: /workspace/dockerconfig
      securityContext:
        capabilities:
          add: ["SETFCAP", "FOWNER"]
      script: |
        cd /workspace/source

        buildah bud \
          --file "$(params.CONTAINERFILE)" \
          --tag "$(params.IMAGE)" \
          --tag "$(params.IMAGE_LATEST)" \
          .

        buildah push --authfile /workspace/dockerconfig/config.json \
          "$(params.IMAGE)" \
          docker://$(params.IMAGE)

        buildah push --authfile /workspace/dockerconfig/config.json \
          "$(params.IMAGE_LATEST)" \
          docker://$(params.IMAGE_LATEST)
```

Key details:
- **Buildah** builds the image from the Containerfile in the cloned repo — no Docker daemon needed
- `buildah bud` is the equivalent of `docker build`
- The `dockerconfig` workspace provides Quay credentials for push
- The `CONTAINERFILE` parameter defaults to `Containerfile`; override with `Dockerfile` if needed
- `SETFCAP` and `FOWNER` capabilities are required for Buildah's overlay mount; your Tekton installation may need a custom `SecurityContextConstraint`

> If Buildah's capability requirements conflict with your cluster's SCC policy, use **kaniko** instead (see [alternative below](#alternative-use-kaniko-instead-of-buildah)).

### Deploy task — roll out the new image

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: build-deploy
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

### Alternative: Use kaniko instead of Buildah

If Buildah's required capabilities are not available in your cluster, use **kaniko** — it runs without any special privileges:

```yaml
steps:
  - name: build-and-push
    image: gcr.io/kaniko-project/executor:latest
    env:
      - name: DOCKER_CONFIG
        value: /workspace/dockerconfig
    script: |
      /kaniko/executor \
        --context=/workspace/source \
        --dockerfile=/workspace/source/$(params.CONTAINERFILE) \
        --destination=$(params.IMAGE) \
        --destination=$(params.IMAGE_LATEST) \
        --cache=true
```

Kaniko reads `DOCKER_CONFIG` automatically from the workspace for registry auth.

### Using the OpenShift Template in a pipeline

Instead of `oc set image`, you can use the [OpenShift Template](../templates/openshift-templates.md) to deploy the full set of resources in a single step:

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: build-deploy
spec:
  params:
    - name: IMAGE_PREFIX
      type: string
    - name: IMAGE_TAG
      type: string
    - name: DEPLOYMENT
      type: string
    - name: NAMESPACE
      type: string
    - name: APP_KEY
      type: string
    - name: APP_URL
      type: string
  steps:
    - name: deploy
      image: registry.access.redhat.com/ubi8/openshift-cli:latest
      script: |
        oc process -f https://raw.githubusercontent.com/bdaley/uconn-openshift-laravel/main/templates/openshift/laravel-template.yaml \
          -p APP_NAME=$(params.DEPLOYMENT) \
          -p NAMESPACE=$(params.NAMESPACE) \
          -p IMAGE=$(params.IMAGE_PREFIX) \
          -p IMAGE_TAG=$(params.IMAGE_TAG) \
          -p APP_KEY=$(params.APP_KEY) \
          -p APP_URL=$(params.APP_URL) \
          | oc apply -f - -n $(params.NAMESPACE)
```

### Alternative: Helm in a pipeline

```yaml
steps:
  - name: deploy
    image: alpine/helm:3.14
    script: |
      helm upgrade --install $(params.DEPLOYMENT) ./templates/helm/laravel \
        --namespace $(params.NAMESPACE) \
        --set image.repository=$(params.IMAGE_PREFIX) \
        --set image.tag=$(params.IMAGE_TAG) \
        --set appKey=$(params.APP_KEY) \
        --set appUrl=$(params.APP_URL)
```

### Alternative: ArgoCD GitOps

With [ArgoCD](../templates/argocd.md), your pipeline only needs to **build and push the image**. ArgoCD monitors your Git repository and syncs the deployment automatically:

```yaml
tasks:
  - name: build
    taskRef:
      name: container-build
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

See the [Deployment Templates overview](../templates/overview.md) to choose the right approach for your team.

### Rolling back a bad deploy

```bash
oc rollout undo deployment/myapp -n <team>-dev
```

List all revisions:

```bash
oc rollout history deployment/myapp -n <team>-dev
```

To roll back to a specific revision:

```bash
oc rollout undo deployment/myapp --to-revision=3 -n <team>-dev
```

## 3. Wire them together in a Pipeline

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: build-pipeline
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
        name: container-build
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
        name: build-deploy
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
oc apply -f container-build.yaml -f build-deploy.yaml -f build-pipeline.yaml -n <team>-dev
```

## 5. Test with a manual PipelineRun

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: build-deploy-manual-
  namespace: <team>-dev
spec:
  pipelineRef:
    name: build-pipeline
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

### TriggerBinding

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

### TriggerTemplate

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: build-deploy-template
spec:
  params:
    - name: GIT_REPO
    - name: GIT_REVISION
  resourcetemplates:
    - apiVersion: tekton.dev/v1
      kind: PipelineRun
      metadata:
        generateName: build-deploy-
      spec:
        pipelineRef:
          name: build-pipeline
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

### EventListener

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
        name: build-deploy-template
```

### Route

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

### Apply

```bash
oc apply -f github-push-binding.yaml -f build-deploy-template.yaml \
  -f github-listener.yaml -f github-listener-route.yaml -n <team>-dev

# Get the webhook URL
oc get route el-github-listener -n <team>-dev -o jsonpath='https://{.spec.host}'
```

## 7. Configure the GitHub webhook

1. Go to your GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: paste the Route URL from above
3. **Content type**: `application/json`
4. **Secret**: (optional) add a secret token
5. **Events**: **Just the push event**
6. **Active**: checked

With the webhook active, every push to `main` will:

1. GitHub sends a POST to the EventListener Route
2. Tekton Triggers creates a PipelineRun
3. The pipeline clones the repo at that commit
4. Buildah (or kaniko) builds the image from the Containerfile and pushes to Quay as `dev:<full-sha>` + `dev:latest`
5. `oc set image` updates the Deployment, triggering a rollout

## Adding a migration step

### Migration task

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: laravel-migrate
spec:
  params:
    - name: DEPLOYMENT
      type: string
    - name: NAMESPACE
      type: string
  steps:
    - name: migrate
      image: registry.access.redhat.com/ubi8/openshift-cli:latest
      script: |
        oc rollout status "deployment/$(params.DEPLOYMENT)" \
          -n "$(params.NAMESPACE)" --timeout=5m
        oc exec "deployment/$(params.DEPLOYMENT)" \
          -n "$(params.NAMESPACE)" -- php artisan migrate --force
```

### Wire it into the pipeline

```yaml
  tasks:
    # ... build task ...
    # ... deploy task ...
    - name: migrate
      taskRef:
        name: laravel-migrate
      runAfter: [deploy]
      params:
        - name: DEPLOYMENT
          value: $(params.DEPLOYMENT)
        - name: NAMESPACE
          value: $(params.NAMESPACE)
```

### SQLite migration pod

For SQLite, the migration task must mount the same `sqlite` PVC. Add a workspace and create a temporary pod:

```yaml
kind: Task
metadata:
  name: laravel-migrate
spec:
  workspaces:
    - name: sqlite
  params:
    - name: DEPLOYMENT
      type: string
    - name: NAMESPACE
      type: string
  steps:
    - name: migrate
      image: registry.access.redhat.com/ubi8/openshift-cli:latest
      script: |
        oc rollout status "deployment/$(params.DEPLOYMENT)" \
          -n "$(params.NAMESPACE)" --timeout=5m
        cat <<EOF | oc apply -f - -n "$(params.NAMESPACE)"
apiVersion: v1
kind: Pod
metadata:
  name: migrate-$(params.DEPLOYMENT)
  labels:
    app: migrate
spec:
  containers:
    - name: migrate
      image: "$(params.IMAGE)"
      command: ["php", "artisan", "migrate", "--force"]
      envFrom:
        - configMapRef:
            name: laravel-env
      volumeMounts:
        - name: sqlite
          mountPath: /var/www/html/database
  volumes:
    - name: sqlite
      persistentVolumeClaim:
        claimName: laravel-sqlite
  restartPolicy: Never
EOF
        oc wait --for=condition=complete pod/migrate-$(params.DEPLOYMENT) \
          -n "$(params.NAMESPACE)" --timeout=5m
        oc delete pod/migrate-$(params.DEPLOYMENT) -n "$(params.NAMESPACE)" --ignore-not-found
```

See the [persistent storage guide](../guides/persistent-storage.md#c-automate-in-cicd) for more details.

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

## Adapting to other git providers

| Provider | Webhook format | Notes |
|---|---|---|
| **GitLab** | `$(body.project.git_http_url)` / `$(body.checkout_sha)` | Adjust TriggerBinding paths |
| **Bitbucket** | `$(body.repository.links.clone[0].href)` / `$(body.after)` | See `tekton-bitbucket.md` for Quay image patterns |
| **Gitea / self-hosted** | Varies | Create a custom TriggerBinding matching the payload |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| PipelineRun stuck on `clone` | Git URL requires authentication | Use an SSH secret or a PAT in the clone URL |
| Buildah fails with permission denied | Missing `SETFCAP` / `FOWNER` capabilities | Add capabilities to the step's `securityContext` or switch to kaniko |
| Kaniko can't push to Quay | `DOCKER_CONFIG` not properly mounted | Verify `dockerconfig` workspace is connected and `config.json` is valid |
| `oc set image` fails (403) | pipeline ServiceAccount lacks permissions | Attach `edit` role: `oc policy add-role-to-user edit -z pipeline` |
| Webhook returns 500 | EventListener can't reach TriggerTemplate | Check `oc get eventlistener -n <team>-dev` status |
| Route not accessible from GitHub | Network policy or TLS mismatch | Verify Route is edge-terminated and cluster has external DNS |
