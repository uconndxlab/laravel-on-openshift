# Persistent Storage for SQLite and Laravel Storage

Laravel applications running on OpenShift need persistent volumes for two things when using SQLite:

| Data | Mount path | Purpose |
|---|---|---|
| **SQLite database** | `/var/www/html/database` | Stores the `database.sqlite` file |
| **Laravel storage** | `/var/www/html/storage` | Uploaded files, logs, compiled views, sessions |

Without persistent volumes, all data is lost when a pod restarts — including the entire database.

## Storage classes

UConn's OpenShift cluster provides at least two storage classes. Ask Platform Engineering which one is available in your namespace:

> **Network policies**: By default, OpenShift allows all pod-to-pod traffic within a namespace. If your namespace has restrictive network policies, ensure they allow pods to reach the Quay registry (`quay.apps.uconn.edu`) and any database services you use.

| Class | Performance | Use case |
|---|---|---|
| `ocs-storagecluster-ceph-rbd` | Fast block storage | SQLite (low latency) |
| `ocs-storagecluster-cephfs` | Shared filesystem | Laravel storage (ReadWriteMany for multi-replica) |

SQLite requires **ReadWriteOnce** — only one pod can write at a time. If you intend to run more than one replica, see [SQLite and replicas](#sqlite-and-replicas).

## 1. Create the PersistentVolumeClaims

```yaml
# pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-sqlite
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-storage
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

```bash
oc apply -f pvc.yaml -n <team>-dev
```

> Set `storageClassName` explicitly if your namespace has multiple storage classes (e.g. `storageClassName: ocs-storagecluster-ceph-rbd`). Ask Platform Engineering for the correct value.

## 2. Mount volumes in your Deployment

Add the volumes to your Deployment's pod template. This example uses `oc patch`; you can also edit the Deployment directly with `oc edit deployment/myapp`.

```bash
# Attach the SQLite PVC
oc set volume deployment/myapp --add \
  --name=sqlite \
  --type=persistentVolumeClaim \
  --claim-name=laravel-sqlite \
  --mount-path=/var/www/html/database \
  -n <team>-dev

# Attach the storage PVC
oc set volume deployment/myapp --add \
  --name=laravel-storage \
  --type=persistentVolumeClaim \
  --claim-name=laravel-storage \
  --mount-path=/var/www/html/storage \
  -n <team>-dev
```

## 3. Add an init container for first-time setup

When a PVC is first mounted, it's empty. An init container must recreate the directories Laravel expects and create the SQLite database file.

```bash
oc patch deployment/myapp --type=strategic -p='
{
  "spec": {
    "template": {
      "spec": {
        "initContainers": [
          {
            "name": "init-storage",
            "image": "quay.apps.uconn.edu/<org>/dev:latest",
            "command": [
              "sh", "-c",
              "mkdir -p storage/app/public storage/framework/cache storage/framework/views storage/framework/sessions storage/logs && chmod -R 775 storage && touch database/database.sqlite && php artisan storage:link || true"
            ],
            "volumeMounts": [
              {"name": "sqlite", "mountPath": "/var/www/html/database"},
              {"name": "laravel-storage", "mountPath": "/var/www/html/storage"}
            ]
          }
        ]
      }
    }
  }
}' -n <team>-dev
```

This runs every time a pod starts, but only has an effect on the first start (or if files are missing). The `|| true` prevents `storage:link` from failing if the symlink already exists.

## 4. Ensure only one replica

SQLite cannot handle concurrent writes from multiple pods.

```bash
oc scale deployment/myapp --replicas=1 -n <team>-dev
```

### Alternative: ReadWriteMany for storage

If you need multiple replicas for Laravel storage (not SQLite), use a `ReadWriteMany` storage class for the `laravel-storage` PVC:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-storage
spec:
  accessModes:
    - ReadWriteMany   # ← allows concurrent access
  resources:
    requests:
      storage: 5Gi
```

The SQLite PVC must remain `ReadWriteOnce`.

## 5. Verify the volumes are mounted

```bash
oc get pods -n <team>-dev
oc exec deployment/myapp -- ls -la /var/www/html/database/database.sqlite
oc exec deployment/myapp -- ls -la /var/www/html/storage/app/public
```

## SQLite and replicas

SQLite is a single-writer database. With only 1 replica you lose high availability for the app tier — if the node fails, your app is down until the pod is rescheduled.

### Options for production

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **1 replica, SQLite** | Simple, no external service | No HA, brief downtime on deploys | Dev, low-traffic internal apps |
| **1 replica + ReadWriteMany storage** | Storage HA, can share files | App tier still single-pod | When storage availability matters more than compute |
| **MySQL/PostgreSQL** | Multi-replica app, HA, replication | Requires external DB deployment | Production apps with > 1 replica |

### Migrating from SQLite to MySQL

1. Create a MySQL deployment in your namespace, or ask Platform Engineering for access to a managed database
2. Update your `.env` / ConfigMap / Secret:

```
DB_CONNECTION=mysql
DB_HOST=<mysql-service-name>
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=<random-password>
```

3. Store `DB_PASSWORD` in a Secret, not a ConfigMap
4. Add the `pdo_mysql` extension to your `composer.json` as an explicit requirement (Paketo PHP buildpacks only install non-default extensions when declared):

```json
"require": {
    "ext-pdo_mysql": "*"
}
```

5. Run `php artisan migrate --force` against the MySQL database
6. Scale the deployment to 2+ replicas

> SQLite and MySQL can run side-by-side during migration. Keep `DB_CONNECTION=sqlite` while testing MySQL, then switch over.

## Running migrations

Migrations must run after a deploy to apply schema changes. You have three options:

### A. Run manually

```bash
oc exec deployment/myapp -- php artisan migrate --force -n <team>-dev
```

### B. Run as a Kubernetes Job

```yaml
# migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: laravel-migrate
  labels:
    app: myapp
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      containers:
        - name: migrate
          image: quay.apps.uconn.edu/<org>/dev:latest
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
```

```bash
oc apply -f migrate-job.yaml -n <team>-dev
```

### C. Automate in CI/CD

See the [CI/CD migration task](../ci-cd/automated-buildpack-deploy.md#adding-a-migration-step) guide for Tekton pipeline integration.

## Viewing logs

Laravel logs appear in `oc logs` when `LOG_CHANNEL=stderr` is set:

```bash
# Tail logs from the running deployment
oc logs deployment/myapp -n <team>-dev -f

# Logs from a specific pod
oc get pods -n <team>-dev
oc logs myapp-7d8f9e2a3-b4c5d -n <team>-dev

# Logs from the init container only
oc logs <pod-name> -c init-storage -n <team>-dev
```

If `LOG_CHANNEL=stack` (the Laravel default), logs are written to `storage/logs/laravel.log` on the PVC instead. Switch to `stderr` for container-native log collection.

> OpenShift's web console also provides a **Logs** tab for each pod. If the Cluster Logging Operator is deployed in your cluster, you can query aggregated logs there as well.

## Backing up the SQLite database

Since SQLite stores everything in a single file, backup is straightforward. Use a Kubernetes CronJob to dump the database periodically:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sqlite-backup
spec:
  schedule: "0 3 * * *"   # daily at 3 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: alpine:3.19
              command:
                - sh
                - -c
                - |
                  sqlite3 /database/database.sqlite ".backup /backup/backup-$(date +%Y%m%d).sqlite"
                  # Optional: upload to remote storage with curl or s3cmd
              volumeMounts:
                - name: sqlite
                  mountPath: /database
                - name: backup
                  mountPath: /backup
          volumes:
            - name: sqlite
              persistentVolumeClaim:
                claimName: laravel-sqlite
            - name: backup
              emptyDir: {}
          restartPolicy: OnFailure
```

For production, add a step that uploads the backup to object storage (S3, Azure Blob, etc.).

## Full Deployment YAML example

For reference, here's what your Deployment should look like after all modifications:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: <team>-dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      initContainers:
        - name: init-storage
          image: quay.apps.uconn.edu/<org>/dev:latest
          command:
            - sh
            - -c
            - |
              mkdir -p storage/app/public storage/framework/cache \
                storage/framework/views storage/framework/sessions storage/logs
              chmod -R 775 storage
              touch database/database.sqlite
              php artisan storage:link || true
          volumeMounts:
            - name: sqlite
              mountPath: /var/www/html/database
            - name: laravel-storage
              mountPath: /var/www/html/storage
      containers:
        - name: app
          image: quay.apps.uconn.edu/<org>/dev:latest
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: laravel-secrets
            - configMapRef:
                name: laravel-env
          resources:
            requests:
              memory: 256Mi
              cpu: 200m
            limits:
              memory: 512Mi
              cpu: 500m
          livenessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: sqlite
              mountPath: /var/www/html/database
            - name: laravel-storage
              mountPath: /var/www/html/storage
      volumes:
        - name: sqlite
          persistentVolumeClaim:
            claimName: laravel-sqlite
        - name: laravel-storage
          persistentVolumeClaim:
            claimName: laravel-storage
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pod stuck in `Init:CrashLoopBackOff` | Init container command failed | `oc logs myapp-pod -c init-storage` to see the error |
| `database.sqlite` not found | Init container didn't create it, or mount path is wrong | Verify `mountPath` matches your Laravel `DB_DATABASE` setting |
| `Unable to write to storage/` | Wrong permissions on PVC | Init container should `chmod 775 storage` |
| `SQLSTATE[HY000]: General error: 23` | Database file is locked by another pod | Check you only have 1 replica |
| PVC stays `Pending` | No storage class available or quota exceeded | `oc describe pvc laravel-sqlite` to see events |
