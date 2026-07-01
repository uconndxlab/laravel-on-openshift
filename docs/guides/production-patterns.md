# Production Patterns

This guide covers common production concerns for Laravel on OpenShift: queue workers, scheduled tasks, blue-green deployments, and database migration from SQLite.

## Queue workers

Laravel queues handle deferred tasks (emails, notifications, job processing). In production, you need a long-running process that calls `php artisan queue:work`.

### Dedicated Deployment

Run the queue worker as a separate Deployment — this lets you scale it independently from the web pods:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-queue-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
      role: queue-worker
  template:
    metadata:
      labels:
        app: myapp
        role: queue-worker
    spec:
      containers:
        - name: worker
          image: quay.apps.uconn.edu/<org>/dev:latest
          command:
            - php
            - artisan
            - queue:work
            - --sleep=3
            - --tries=3
            - --max-time=3600
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
```

```bash
oc apply -f queue-worker.yaml -n <team>-dev
```

> Queue workers should use the same Secrets and ConfigMap as the web deployment. They do not need a Route or Service.

### Using a shared PVC

If your queue driver uses files (e.g., `database` or `sync`), the worker needs access to the same SQLite PVC:

```yaml
volumeMounts:
  - name: sqlite
    mountPath: /var/www/html/database
volumes:
  - name: sqlite
    persistentVolumeClaim:
      claimName: laravel-sqlite
```

For production, consider using a dedicated queue driver like Redis or Amazon SQS instead.

### Restarting workers after deploy

After a new deployment, workers running old code may behave incorrectly. The cleanest approach is to redeploy the worker together with the web deployment:

```bash
oc rollout restart deployment/myapp-queue-worker -n <team>-dev
```

In a Tekton pipeline, add a deploy task for the worker:

```yaml
- name: deploy-worker
  taskRef:
    name: buildpack-deploy
  runAfter: [migrate]
  params:
    - name: IMAGE
      value: $(params.IMAGE_PREFIX):$(params.GIT_REVISION)
    - name: DEPLOYMENT
      value: myapp-queue-worker
    - name: CONTAINER
      value: app
    - name: NAMESPACE
      value: $(params.NAMESPACE)
```

## Scheduled tasks (Laravel scheduler)

Laravel's scheduler (`php artisan schedule:run`) needs to run every minute. On OpenShift, use a **CronJob**:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: laravel-scheduler
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: scheduler
              image: quay.apps.uconn.edu/<org>/dev:latest
              command:
                - php
                - artisan
                - schedule:run
              envFrom:
                - secretRef:
                    name: laravel-secrets
                - configMapRef:
                    name: laravel-env
          restartPolicy: Never
```

```bash
oc apply -f scheduler-cronjob.yaml -n <team>-dev
```

Key flags:

| Setting | Purpose |
|---|---|
| `schedule: "* * * * *"` | Runs every minute (Laravel's expected cadence) |
| `concurrencyPolicy: Forbid` | Prevents overlapping runs if one takes > 1 minute |
| `restartPolicy: Never` | Each invocation runs once; if it fails, the next minute retries |

## Blue-green deployments

With SQLite's single-replica limitation, rolling updates cause brief downtime (the old pod stops before the new one starts). **Blue-green** eliminates downtime by running two deployments and switching traffic atomically.

### How it works

1. **Blue** (current, live) — serves production traffic via the current Service
2. **Green** (new) — deploy the new image alongside, with its own PVC, same data
3. **Switch** — update the Service's label selector to point to Green
4. **Clean up** — scale down Blue

### Implementation

```bash
# Deploy the new version as "myapp-green"
oc new-app quay.apps.uconn.edu/<org>/prod:new-release --name=myapp-green -n <team>-prod

# Apply the same PVC, init container, probes, and resources (steps 5–8 from quickstart)

# Switch the Service to point at the green deployment
oc patch service myapp -p '{"spec":{"selector":{"app":"myapp-green"}}}' -n <team>-prod

# Verify traffic is flowing, then scale down blue
oc scale deployment/myapp --replicas=0 -n <team>-prod
```

> Blue-green requires the SQLite PVC to support `ReadWriteMany` (or using MySQL/PostgreSQL), since both blue and green pods need concurrent access to the database. With `ReadWriteOnce`, use a rolling update instead — the brief downtime is acceptable for many apps.

## Migrating from SQLite to MySQL/PostgreSQL

When your app outgrows SQLite's single-replica limitation, migrate to a dedicated database.

### Step-by-step

1. **Deploy a database** in your namespace or provision one through Platform Engineering. For MySQL:

```bash
oc new-app mysql:8.0 --name=mysql -n <team>-dev \
  -e MYSQL_USER=laravel \
  -e MYSQL_PASSWORD=<random-password> \
  -e MYSQL_DATABASE=laravel \
  -e MYSQL_ROOT_PASSWORD=<root-password>
```

2. **Store credentials in a Secret**:

```bash
oc create secret generic mysql-creds \
  --from-literal=DB_CONNECTION=mysql \
  --from-literal=DB_HOST=mysql \
  --from-literal=DB_PORT=3306 \
  --from-literal=DB_DATABASE=laravel \
  --from-literal=DB_USERNAME=laravel \
  --from-literal=DB_PASSWORD=<random-password> \
  -n <team>-dev
```

3. **Attach to the deployment**:

```bash
oc set env deployment/myapp --from=secret/mysql-creds -n <team>-dev
```

4. **Run migrations** against the new database:

```bash
oc exec deployment/myapp -- php artisan migrate --force
```

5. **Scale up**:

```bash
oc scale deployment/myapp --replicas=3 -n <team>-dev
```

6. **Remove SQLite PVCs** once confirmed:

```bash
oc set volume deployment/myapp --remove --name=sqlite -n <team>-dev
oc delete pvc laravel-sqlite -n <team>-dev
```

> You can keep `DB_CONNECTION=sqlite` while testing MySQL in a separate environment. Only switch the production namespace once you're confident the migration is complete.

## Zero-downtime with rolling updates

Even with 1 replica, you can reduce downtime by tuning the rolling update parameters:

```bash
oc patch deployment/myapp -p '{
  "spec": {
    "strategy": {
      "type": "RollingUpdate",
      "rollingUpdate": {
        "maxUnavailable": 0,
        "maxSurge": 1
      }
    }
  }
}' -n <team>-dev
```

- `maxUnavailable: 0` — never run fewer than 1 pod
- `maxSurge: 1` — spin up the new pod before terminating the old one

This requires the SQLite PVC to use `ReadWriteMany` (or a separate database), because both the old and new pod need to mount the database simultaneously during the transition.
