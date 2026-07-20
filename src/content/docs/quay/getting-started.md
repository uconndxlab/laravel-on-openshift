---
title: Quay Registry — Getting Started
description: Sign in, authenticate, and push container images to UConn's Quay registry
---

UConn's private container registry is hosted at **`quay.apps.uconn.edu`**.

## Sign in

1. Go to [quay.apps.uconn.edu](https://quay.apps.uconn.edu)
2. Click **Sign in with UConn EntraID** and use your UConn email address

## What you get

- A team organization in Quay (same name as your team/namespace)
- Three standard repositories: `dev`, `test`, `prod` (created by admins)
- Robot accounts for pushing, scoped per repo/environment
- An OpenShift `imagePullSecret` created by automation for cluster pulls

## Browse and verify access

```bash
# Open the UI
open https://quay.apps.uconn.edu

# Select your organization (e.g., its-ssg)
# You should see repositories: dev, test, prod
```

Regular users cannot view robot accounts in the UI; admins manage robot credentials.

## Install a container client

You need a container client to build and push images:

- **Podman** (preferred): [podman.io/getting-started/installation](https://podman.io/getting-started/installation)
- **Docker**: [docs.docker.com/get-docker/](https://docs.docker.com/get-docker/)

## Get robot credentials

To push images, you'll need a robot account username and token scoped to the target repository. These are provided by your org admin or Platform Engineering.

## Login from the command line

```bash
podman login quay.apps.uconn.edu
# Username: <org>+dev        (example: its-ssg+dev)
# Password: <robot_token>    (provided by admin)
```

## Tag and push

```bash
# Push to dev
podman tag myapp:1.0 quay.apps.uconn.edu/<org>/dev:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/dev:myapp_v1.0

# Promote to test
podman tag myapp:1.0 quay.apps.uconn.edu/<org>/test:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/test:myapp_v1.0

# Promote to prod
podman tag myapp:1.0 quay.apps.uconn.edu/<org>/prod:myapp_v1.0
podman push quay.apps.uconn.edu/<org>/prod:myapp_v1.0
```

## Pull an image locally

```bash
podman pull quay.apps.uconn.edu/<org>/dev:myapp_v1.0
```

## Using images in OpenShift

Deployments can reference Quay images directly:

```yaml
image: quay.apps.uconn.edu/<org>/dev:myapp_v1.0
```

## Find your imagePullSecret

```bash
oc -n <team>-dev get sa default -o jsonpath='{.imagePullSecrets[*].name}'
oc -n <team>-dev describe sa default | grep -i 'Image pull secrets\|quay-pull'
```

Look for a secret named `quay-pull-<team>`. If missing, contact Platform Engineering.

## Best practices

- Use versioned tags (e.g., `1.0.3`) rather than only `latest`
- Keep repositories private unless there is a documented need
- Do not store large base OS images unless required
- Treat robot tokens like passwords; store them in approved secret stores (not in git)
