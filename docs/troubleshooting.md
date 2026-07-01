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
oc create secret generic laravel-secrets \
  --from-literal=APP_KEY=$(php artisan key:generate --show)
oc set env deployment/myapp --from=secret/laravel-secrets
```

## Pod is stuck in `CrashLoopBackOff` or `Init:CrashLoopBackOff`

**Cause**: The application (or init container) is crashing on startup.

**Check**:
```bash
oc logs <pod-name> -n <namespace>
oc logs <pod-name> -c init-storage -n <namespace>   # for init container issues
oc describe pod <pod-name> -n <namespace>            # for events & exit codes
```

**Common init container failures**:
- `mkdir: can't create directory '...': Permission denied` — PVC permissions issue; add `chmod` to the init command
- `php artisan storage:link` fails — the symlink already exists; add `|| true` to the command

## Pod is `Running` but not `Ready` (readiness probe failing)

**Cause**: The readiness probe is not getting a 200 response.

**Check**:
```bash
oc describe pod <pod-name> -n <namespace>
# Look for "Readiness probe failed:" in the Events section
```

**Common causes**:
- The app takes longer to start than the `initialDelaySeconds` setting
- The probe path is wrong (e.g., probe hits `/` but the app serves from a subpath)
- `APP_KEY` is missing or wrong (Laravel returns 500, which is not 200)

**Fix**:
- Increase `initialDelaySeconds` via `oc set probe deployment/myapp --liveness --initial-delay-seconds=60 ...`
- Verify the app responds: `oc exec deployment/myapp -- curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/`

## Pod is OOMKilled (Out Of Memory)

**Cause**: The container exceeded its memory limit.

**Check**:
```bash
oc describe pod <pod-name> -n <namespace>
# Look for "OOMKilled" in the last state
```

**Fix**:
```bash
oc set resources deployment/myapp --limits=memory=1Gi --requests=memory=512Mi -n <namespace>
```

PHP-FPM memory usage scales with the number of workers. Start with 256Mi–512Mi and adjust based on `oc adm top pods`.

## Route returns 503 or connection refused

**Cause**: The Service is not targeting the correct port, or no pod is ready.

**Check**:
```bash
oc get svc myapp -n <namespace> -o yaml
# Verify targetPort matches the container port (8080)

oc get endpoints myapp -n <namespace>
# Should list at least one ready pod IP
```

**Fix**:
- If the Service port is wrong: `oc edit svc myapp -n <namespace>` and correct `targetPort`
- If no endpoints: check the pod status and readiness probe above

## No logs visible from `oc logs`

**Cause**: Laravel is writing logs to a file instead of stderr.

**Fix**: Set `LOG_CHANNEL=stderr` in your ConfigMap or Secret:

```bash
oc create configmap laravel-env --from-literal=LOG_CHANNEL=stderr --dry-run=client -o yaml | oc apply -f -
oc set env deployment/myapp --from=configmap/laravel-env --overwrite -n <namespace>
```

The default `LOG_CHANNEL=stack` writes to `storage/logs/laravel.log` on the PVC, which is not visible via `oc logs`.

## Database file locked (SQLite)

**Symptom**: `SQLSTATE[HY000]: General error: 23` or `database is locked`.

**Cause**: More than one pod is trying to write to the SQLite database simultaneously.

**Fix**:
```bash
oc scale deployment/myapp --replicas=1 -n <namespace>
```

SQLite is a single-writer database. See the [persistent storage guide](guides/persistent-storage.md#sqlite-and-replicas) for migration options.

## Need more help?

Contact Platform Engineering: **abiodun@uconn.edu**, **bharani@uconn.edu**
