---
title: Going Live
description: Make your application publicly accessible on UConn OpenShift
---

This guide covers the steps required to expose your application to the public internet — from verifying permissions to DNS setup.

## Prerequisites

Your namespace must have the correct RBAC permissions to manage Routes. By default, the `edit` cluster role does not include permissions to view or modify Roles or RoleBindings.

Verify your permissions:

```bash
oc auth can-i create routes -n <namespace>
oc auth can-i get routes -n <namespace>
oc auth can-i get roles -n <namespace>
oc auth can-i get rolebindings -n <namespace>
```

If any of these return `no`, contact ITS to update your RBAC role to include Route, Role, and RoleBinding management within your namespace.

## Step 1: Label the route

Add the `class: public` label to your existing Route. This attaches an external public router that makes your application reachable from the internet:

```bash
oc label route <name> class=public -n <namespace>
```

Verify the label was applied:

```bash
oc get route <name> -n <namespace> -o yaml | grep class
```

After labeling, confirm the app is accessible via its existing Route URL (e.g., `https://myapp-team-dev.apps.uconn.edu`):

```bash
curl -I https://<existing-route-hostname>
```

The app should respond with a `200 OK` or `302 Found` — this confirms the public router is working before you request a custom domain.

## Step 2: Create a Jira ticket

Open a ticket with ITS requesting a custom DNS record. Include:

- **Existing Route URL**: Your labeled Route hostname (e.g., `myapp-team-dev.apps.uconn.edu`)
- **Desired custom domain**: The URL you want exposed (e.g., `myapp.uconn.edu`)
- **Namespace**: Your OpenShift project name
- **Request**: A CNAME record pointing your custom domain to the public router

## Step 3: ITS creates the DNS record

Once the Jira ticket is processed, ITS will create a CNAME record pointing your custom domain to the public router. After propagation, your app will be accessible at the custom URL.

## Verification

```bash
curl -I https://your-custom-domain
```

Check that the Route is still properly configured:

```bash
oc describe route <name> -n <namespace>
```

## Repository guidance

ITS recommends using Bitbucket for source control while management determines the policy on public GitHub repositories.
