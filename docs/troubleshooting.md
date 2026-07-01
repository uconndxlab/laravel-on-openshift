# Troubleshooting

## 401 Unauthorized from Quay pulls

**Cause**: The ServiceAccount used by the Pod or TaskRun is missing the Quay `imagePullSecret`.

**Check**:
```bash
oc describe sa default -n <namespace>
# Look for "Image pull secrets:  quay-pull-<team>"
```

**Fix**: Contact Platform Engineering to attach the pull secret to your ServiceAccount.

## Repository not found in Quay

**Cause**: The target repository (`dev`, `test`, `prod`) has not been created for your org.

**Fix**: Ask Platform Engineering to create the repository.

## TLS / certificate errors

**Cause**: The cluster or node trust bundle is missing the registry CA.

**Fix**: Contact Platform Engineering to update the trust bundle.

## Build fails — "no space left on device"

**Cause**: The node's container storage is full.

**Fix**: Clean up unused images or contact Platform Engineering to add node capacity.

## Laravel — "No application encryption key"

**Cause**: The `APP_KEY` environment variable is not set.

**Fix**:
```bash
oc create configmap laravel-env --from-literal=APP_KEY=$(php artisan key:generate --show)
oc set env deployment/myapp --from=configmap/laravel-env
```

## Need more help?

Contact Platform Engineering: **abiodun@uconn.edu**, **bharani@uconn.edu**
