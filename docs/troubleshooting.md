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

## Laravel — Mixed content warnings (assets served over HTTP)

**Symptom**: The page loads over HTTPS, but CSS, JavaScript, and other assets are loaded over HTTP. Browser console shows mixed content warnings.

**Cause**: OpenShift Routes use edge TLS termination — the Route terminates HTTPS at the edge and forwards plain HTTP to the pod. Laravel detects the incoming scheme as HTTP and generates `http://` asset URLs. If `APP_URL` in your ConfigMap or `.env` starts with `http://` (or is unset), the problem compounds.

**Fix**: Set `APP_URL` to `https://` in your ConfigMap and clear the config cache:

```bash
# Update the ConfigMap
oc create configmap laravel-env \
  --from-literal=APP_URL=https://myapp-<team>-dev.apps.uconn.edu \
  --from-literal=LOG_CHANNEL=stderr \
  --dry-run=client -o yaml | oc apply -f -

# Redeploy to pick up the change
oc rollout restart deployment/myapp -n <team>-dev

# Clear Laravel's cached config inside the pod
oc exec deployment/myapp -- php artisan config:clear
oc exec deployment/myapp -- php artisan cache:clear
```

The `APP_URL` must match your Route's hostname with `https://`:

```bash
oc get route myapp -n <team>-dev -o jsonpath='https://{.spec.host}{"\n"}'
```

If you use the [OpenShift Template](templates/openshift-templates.md), always pass `-p APP_URL=https://<your-route-host>` when deploying.

## PostgreSQL — "Skipping initialization" / Database not created after PVC swap

**Symptom**: Pod logs show `PostgreSQL database directory appears to contain a database; Skipping initialization`, and your custom database (`POSTGRES_DB`) does not exist. Connecting as `postgres` succeeds but `\l` only shows `postgres`, `template1`, `template0`.

**Cause**: A new or replaced PVC is not truly empty — it contains a `lost+found` folder at the root. PostgreSQL requires a completely empty directory to run its initialization script, so it skips creating users and databases from environment variables.

**Fix**:
- **subPath**: Mount the volume with `subPath: pgdata` to isolate data into a clean subdirectory:
  ```yaml
  volumeMounts:
    - name: data
      mountPath: /var/lib/postgresql/data
      subPath: pgdata
  ```
- **PGDATA**: Set `PGDATA` to a subdirectory of the mount:
  ```yaml
  env:
    - name: PGDATA
      value: /var/lib/postgresql/data/pgdata
  ```

Either approach is sufficient; both can be used together for safety.

**Diagnose**:
```bash
oc exec deployment/postgres -- psql -U postgres -d postgres -c "\l"
```

## PostgreSQL — Data lost after pod re-creation (wrong mount path)

**Symptom**: Database data is missing after the pod restarts or is re-created, even though a PVC is mounted.

**Cause**: The volume is mounted at the wrong path. For PostgreSQL 17 and below, the image declares `VOLUME /var/lib/postgresql/data`. Mounting at `/var/lib/postgresql` (the parent) causes the container runtime to create an anonymous volume at `/var/lib/postgresql/data` that is not reused across container re-creations — data goes to the anonymous volume, not your PVC.

**Fix**: Mount the PVC at `/var/lib/postgresql/data` (not `/var/lib/postgresql`).

> **PostgreSQL 18+**: The `VOLUME` was changed to `/var/lib/postgresql` and `PGDATA` defaults to `/var/lib/postgresql/18/docker`. On 18+, mount at `/var/lib/postgresql` and set `PGDATA` to the version-specific path if needed.

## Need more help?

Contact Platform Engineering: **abiodun@uconn.edu**, **bharani@uconn.edu**
