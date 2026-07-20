---
title: Tekton Pipelines-as-Code with Bitbucket
description: Use Quay images in Tekton Pipelines-as-Code with Bitbucket repositories
---

This guide covers using Tekton Pipelines-as-Code with Bitbucket repositories, including pulling images from Quay.

## What's already set up

- **Quay org**: matches your team name (same as namespace prefix)
- **Standard repos**: `dev`, `test`, `prod` (created by admins)
- **Robot accounts**: repo-scoped for push (admins distribute tokens)
- **OpenShift imagePullSecret**: created by onboarding automation
- **Pipeline ServiceAccount**: now includes the Quay pull secret

## Confirm Tekton can pull from Quay

In each namespace, a pull secret named `quay-pull-<namespace>` is created and attached to the pipeline ServiceAccount.

```bash
oc -n <namespace> get sa pipeline -o jsonpath='{.imagePullSecrets[*].name}'
oc -n <namespace> describe sa pipeline | grep -i 'Image pull secrets\|quay-pull'
```

If the secret is missing, email **aap@uconn.edu**.

## Use Quay images in Tekton Tasks

Once the pipeline ServiceAccount has the pull secret, reference Quay images directly in
Task steps:

```yaml
steps:
  - name: run-tests
    image: quay.apps.uconn.edu/<org>/dev:<your-tooling-tag>
    script: |
      set -euo pipefail
      ./run-tests.sh
```

No additional registry credentials are required for pulls.

## Bitbucket secrets (source + GitOps)

Keep Quay credentials separate from Git credentials:

- **Bitbucket auth**: stored in a Secret (e.g., `bitbucketsvc` or `bitbucket-ssh-auth`)
- **GitOps write auth**: stored in a Secret (e.g., `deploy-argo-tekton-write`), mounted at `/creds`
- **Quay pull access**: comes from `imagePullSecrets` on the pipeline ServiceAccount

## Using Quay images in deployments

When your Deployment references Quay, the namespace ServiceAccounts can pull using the onboarded secret:

```yaml
image: quay.apps.uconn.edu/<org>/dev:myapp_v1.0
```

## When you need push access

Only robot accounts can push. If your Tekton pipeline must push to Quay:

1. Request the correct robot username + token from your org admin (scoped to the target repo)
2. Store that token as a Secret in your namespace (do not store in Git)
3. Reference it as a registry credential (e.g., `dockerconfigjson`) in the Task that performs the push

If you share your build-and-push Task (Kaniko, Buildah, or S2I), Platform Engineering can provide a copy/paste Secret and mount layout matching your setup.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 401 from Quay pulls | ServiceAccount missing `quay-pull-<team>` in `imagePullSecrets` |
| Repo not found | Repo not yet created by admins |
| TLS errors | Cluster trust bundle missing registry CA |

**Contact Platform Engineering**: abiodun@uconn.edu, bharani@uconn.edu
