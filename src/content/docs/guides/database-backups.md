---
title: Database Backups
description: Regular automated backups for SQLite and PostgreSQL databases on OpenShift
---

Database backups are a critical part of any production deployment. This guide covers automated daily backups for both SQLite and PostgreSQL databases using Kubernetes CronJobs, with backups stored on a dedicated PVC and 30-day retention.

## Backup strategy

| Database | Tool | Backup type | Destination | Retention |
|---|---|---|---|---|
| SQLite | `sqlite3 .backup` | File-level copy | Dedicated PVC (`laravel-sqlite-backups`) | 30 days |
| PostgreSQL | `pg_dump` | Logical dump (compressed) | Dedicated PVC (`postgres-backups`) | 30 days |

Both approaches share the same pattern:

- A **CronJob** runs daily (3 AM) in the same namespace
- The source database PVC is mounted **read-only** (SQLite) or accessed via the cluster DNS service (PostgreSQL)
- The backup PVC stores historical copies
- Backups older than 30 days are pruned automatically

---

## Setup for both databases

### 1. Create a backup PVC

Each database type needs its own backup PVC so restore operations on one don't interfere with the other.

```yaml
# backup-pvcs.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-sqlite-backups
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-backups
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

```bash
oc apply -f backup-pvcs.yaml -n <team>-dev
```

> **Storage sizing:** 10 Gi is a starting point. Monitor actual usage with `oc exec deployment/myapp -- du -sh /backup` (adapted for the backup pod) and adjust as needed. Each daily SQLite backup is roughly the size of your `database.sqlite` file; compressed PostgreSQL dumps are usually much smaller than the live database size.

### 2. Grant the CronJob service account access to PVCs

CronJobs run under the `default` service account by default, which typically has sufficient permissions to mount PVCs. If your namespace uses restrictive RBAC, ensure the service account can `get` and `watch` PVCs.

---

## SQLite backup

### CronJob

```yaml
# sqlite-backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sqlite-backup
  labels:
    app: myapp
spec:
  schedule: "0 3 * * *"
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
                  apk add --no-cache sqlite
                  mkdir -p /backup
                  sqlite3 /database/database.sqlite ".backup /backup/backup-$(date +%Y%m%d).sqlite"
                  find /backup -name "*.sqlite" -type f -mtime +30 -delete
              volumeMounts:
                - name: sqlite
                  mountPath: /database
                  readOnly: true
                - name: backups
                  mountPath: /backup
          volumes:
            - name: sqlite
              persistentVolumeClaim:
                claimName: laravel-sqlite
                readOnly: true
            - name: backups
              persistentVolumeClaim:
                claimName: laravel-sqlite-backups
          restartPolicy: OnFailure
```

**Key points:**

- The source `laravel-sqlite` PVC is mounted **read-only** to prevent accidental corruption
- `sqlite3 .backup` produces a fully consistent snapshot even while the source database is in use
- The `find -mtime +30 -delete` step removes any backup file older than 30 days
- The CronJob uses `alpine:3.19` and installs `sqlite` on each run (the package is ~2 MB)

### Restore from a SQLite backup

```bash
# 1. Scale the app down to prevent writes during restore
oc scale deployment/myapp --replicas=0 -n <team>-dev

# 2. Copy the backup file onto the SQLite PVC
#    Launch a temporary pod with both the backup and source PVCs
oc run sqlite-restore --image=alpine:3.19 --restart=Never --rm -it \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "restore",
      "image": "alpine:3.19",
      "command": ["sh", "-c", "cp /backup/backup-20260101.sqlite /database/database.sqlite"],
      "volumeMounts": [
        {"name": "sqlite", "mountPath": "/database"},
        {"name": "backups", "mountPath": "/backup"}
      ]
    }],
    "volumes": [
      {"name": "sqlite", "persistentVolumeClaim": {"claimName": "laravel-sqlite"}},
      {"name": "backups", "persistentVolumeClaim": {"claimName": "laravel-sqlite-backups"}}
    ]
  }
}' -n <team>-dev

# 3. Scale the app back up
oc scale deployment/myapp --replicas=1 -n <team>-dev
```

Replace `backup-20260101.sqlite` with the actual filename of the backup you want to restore.

---

## PostgreSQL backup

### Prerequisites

A PostgreSQL deployment already exists in the namespace (see the [Persistent Storage guide](/guides/persistent-storage/#postgresql-on-pvcs)) with a Secret containing the database credentials:

```bash
oc get secret postgres-creds -n <team>-dev
```

The CronJob below references `postgres-creds` to authenticate `pg_dump`.

### CronJob

```yaml
# postgres-backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  labels:
    app: postgres
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:17
              command:
                - sh
                - -c
                - |
                  export PGPASSWORD=$POSTGRES_PASSWORD
                  pg_dump -h postgres -U $POSTGRES_USER -d $POSTGRES_DB \
                    --no-owner --no-acl \
                    | gzip > /backup/backup-$(date +%Y%m%d).sql.gz
                  find /backup -name "*.sql.gz" -type f -mtime +30 -delete
              env:
                - name: POSTGRES_USER
                  valueFrom:
                    secretKeyRef:
                      name: postgres-creds
                      key: username
                - name: POSTGRES_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: postgres-creds
                      key: password
                - name: POSTGRES_DB
                  valueFrom:
                    secretKeyRef:
                      name: postgres-creds
                      key: database
              volumeMounts:
                - name: backups
                  mountPath: /backup
          volumes:
            - name: backups
              persistentVolumeClaim:
                claimName: postgres-backups
          restartPolicy: OnFailure
```

**Key points:**

- Uses the official `postgres:17` image which includes `pg_dump`
- Connects to the PostgreSQL service via its Kubernetes DNS name (`postgres`)
- `PGPASSWORD` is set from the Secret and passed to `pg_dump` (never hardcoded)
- `--no-owner --no-acl` produces a more portable dump that doesn't depend on matching PostgreSQL roles
- Output is gzip-compressed; a 1 GiB database typically compresses to 100–200 MiB
- The `find -mtime +30 -delete` step prunes backups older than 30 days

> **PostgreSQL 18+ users:** If you are running PostgreSQL 18 or later, change the image tag to `postgres:18` or `postgres:19` as appropriate. `pg_dump` is forward-compatible — a newer `pg_dump` can always dump an older server.

### Restore from a PostgreSQL backup

```bash
# 1. Get the credentials
oc get secret postgres-creds -n <team>-dev -o jsonpath='{.data}'

# 2. Launch a temporary pod with the backup PVC
oc run postgres-restore --image=postgres:17 --restart=Never --rm -it \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "restore",
      "image": "postgres:17",
      "command": ["sh", "-c", "gunzip -c /backup/backup-20260101.sql.gz | psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB"],
      "env": [
        {"name": "PGPASSWORD", "valueFrom": {"secretKeyRef": {"name": "postgres-creds", "key": "password"}}},
        {"name": "POSTGRES_USER", "valueFrom": {"secretKeyRef": {"name": "postgres-creds", "key": "username"}}},
        {"name": "POSTGRES_DB", "valueFrom": {"secretKeyRef": {"name": "postgres-creds", "key": "database"}}}
      ],
      "volumeMounts": [
        {"name": "backups", "mountPath": "/backup"}
      ]
    }],
    "volumes": [
      {"name": "backups", "persistentVolumeClaim": {"claimName": "postgres-backups"}}
    ]
  }
}' -n <team>-dev
```

Replace `backup-20260101.sql.gz` with the actual filename of the backup you want to restore.

> The restore drops into the existing database. If you need to restore to a clean state, drop and recreate the database first via `oc exec deployment/postgres -- psql -U laravel -c "DROP DATABASE laravel; CREATE DATABASE laravel;"`.

---

## Monitoring backups

Check that backups ran successfully:

```bash
# List recent backup jobs
oc get jobs -n <team>-dev | grep -E 'sqlite-backup|postgres-backup'

# View logs of the most recent run
oc logs job/sqlite-backup-<job-id> -n <team>-dev

# List backup files on the backup PVC
oc run list-backups --image=alpine:3.19 --restart=Never --rm -it \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "list",
      "image": "alpine:3.19",
      "command": ["ls", "-lh", "/backup"],
      "volumeMounts": [{"name": "backups", "mountPath": "/backup"}]
    }],
    "volumes": [
      {"name": "backups", "persistentVolumeClaim": {"claimName": "laravel-sqlite-backups"}}
      ]
    }
  }' -n <team>-dev
```

Add a liveness check or alerting on backup failure (e.g., a failed CronJob sends a notification). For low- to medium-traffic apps, **test a restore at least once per quarter** to verify the backups are usable.

---

## Storage lifecycle

The backup PVCs will fill over time if the retention cleanup fails. Monitor disk usage:

```bash
# Check backup PVC usage via `oc describe`
oc describe pvc laravel-sqlite-backups -n <team>-dev | grep -i used

# Or check directly from a pod
oc run du-backups --image=alpine:3.19 --restart=Never --rm -it \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "du",
      "image": "alpine:3.19",
      "command": ["du", "-sh", "/backup"],
      "volumeMounts": [{"name": "backups", "mountPath": "/backup"}]
    }],
    "volumes": [
      {"name": "backups", "persistentVolumeClaim": {"claimName": "laravel-sqlite-backups"}}
    ]
  }
}' -n <team>-dev
```

If backups grow beyond the PVC size, increase the storage request (see [Expanding PVCs in OpenShift](https://docs.openshift.com/container-platform/latest/storage/expanding-persistent-volume-claims.html)). Most UConn storage classes support online expansion.
