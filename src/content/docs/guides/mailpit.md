---
title: Email Catching with Mailpit
description: Deploy Mailpit on OpenShift to catch and inspect emails during development and testing
---

Laravel applications running on OpenShift typically route email through the UConn SMTP server for production delivery. During development and testing, however, you may want to **catch email** rather than send it — inspecting messages in a web UI without worrying about accidentally emailing real users.

[Mailpit](https://github.com/axllent/mailpit) is an email testing tool that acts as an SMTP server, captures all messages, and provides a web interface to view them. This guide covers deploying Mailpit on OpenShift with persistent storage and basic authentication.

## Required environment variables

| Variable | Recommended value | Purpose |
|---|---|---|
| `MP_DATABASE` | `/data/mailpit.db` | SQLite database path on the PVC — messages persist across pod restarts |
| `MP_UI_AUTH_FILE` | `/etc/mailpit/htpasswd` | Path to the basic auth file mounted from an OpenShift Secret |
| `MP_MAX_MESSAGES` | `1000` | Maximum retained messages before auto-deleting old ones (`0` disables the limit) |

## 1. Create the auth Secret

Mailpit uses standard `htpasswd` files for basic authentication. Create the password file locally and upload it as a Secret:

```bash
# Create local htpasswd file (use -B for BCrypt)
htpasswd -B -c ./htpasswd demo_user

# Store in OpenShift as a Secret
oc create secret generic mailpit-auth --from-file=htpasswd=./htpasswd -n <team>-dev
```

> Use a strong password. The web UI will prompt for these credentials on every visit.

## 2. Create the PersistentVolumeClaim

Save as `mailpit-pvc.yaml` and apply:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mailpit-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
```

```bash
oc apply -f mailpit-pvc.yaml -n <team>-dev
```

2 Gi is a reasonable starting point. Mailpit's SQLite database is small — adjust based on your message volume and retention settings.

## 3. Deploy Mailpit

Save as `mailpit-deployment.yaml` and apply:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mailpit
  labels:
    app: mailpit
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: mailpit
  template:
    metadata:
      labels:
        app: mailpit
    spec:
      containers:
        - name: mailpit
          image: axllent/mailpit:latest
          env:
            - name: MP_DATABASE
              value: "/data/mailpit.db"
            - name: MP_UI_AUTH_FILE
              value: "/etc/mailpit/htpasswd"
          ports:
            - name: smtp
              containerPort: 1025
            - name: http
              containerPort: 8025
          volumeMounts:
            - name: storage
              mountPath: /data
            - name: auth-file
              mountPath: /etc/mailpit
              readOnly: true
      volumes:
        - name: storage
          persistentVolumeClaim:
            claimName: mailpit-data
        - name: auth-file
          secret:
            secretName: mailpit-auth
```

```bash
oc apply -f mailpit-deployment.yaml -n <team>-dev
```

> **Recreate strategy** is used to ensure only one pod accesses the SQLite database file at a time, preventing file corruption.

## 4. Create Services and Route

Save as `mailpit-services.yaml` and apply:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mailpit
spec:
  selector:
    app: mailpit
  ports:
    - name: smtp
      port: 1025
      targetPort: 1025
    - name: http
      port: 8025
      targetPort: 8025
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: mailpit-ui
spec:
  to:
    kind: Service
    name: mailpit
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

```bash
oc apply -f mailpit-services.yaml -n <team>-dev
```

The Route uses **edge TLS termination** with HTTP-to-HTTPS redirect, matching the pattern used throughout this site.

## 5. Connect your Laravel app

Configure your Laravel application to use Mailpit as its mail driver. Set these environment variables in your ConfigMap or Secret:

```
MAIL_MAILER=smtp
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
```

```bash
# Update your existing laravel-env ConfigMap
oc create configmap laravel-env \
  --from-literal=MAIL_MAILER=smtp \
  --from-literal=MAIL_HOST=mailpit \
  --from-literal=MAIL_PORT=1025 \
  --from-literal=MAIL_USERNAME=null \
  --from-literal=MAIL_PASSWORD=null \
  --from-literal=MAIL_ENCRYPTION=null \
  --dry-run=client -o yaml | oc apply -f - -n <team>-dev

# Redeploy to pick up the changes
oc rollout restart deployment/myapp -n <team>-dev
```

> Mailpit does not require authentication or encryption, so set `MAIL_USERNAME`, `MAIL_PASSWORD`, and `MAIL_ENCRYPTION` to `null`.

## Accessing the web UI

Find the Route URL:

```bash
oc get route mailpit-ui -n <team>-dev
```

Open the URL in a browser. You will be prompted for the username and password you created with `htpasswd` in step 1. All emails sent by your Laravel application will appear here.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Mailpit pod won't start | PVC not bound or `mailpit-auth` Secret missing | `oc describe pod mailpit -n <team>-dev` for events |
| 503 when accessing the Route | Pod is not ready or Service port is wrong | `oc get pods -n <team>-dev` and `oc get endpoints mailpit -n <team>-dev` |
| "401 Unauthorized" in web UI | Wrong htpasswd credentials | Recreate the Secret: `htpasswd -B -c ./htpasswd <user>` then `oc create secret generic mailpit-auth --from-file=htpasswd=./htpasswd --dry-run=client -o yaml \| oc apply -f -` |
| Laravel emails don't appear | Wrong `MAIL_HOST` or `MAIL_PORT` | Verify environment: `oc exec deployment/myapp -- env \| grep MAIL_` |
| Messages lost after pod restart | `MP_DATABASE` not set or PVC not mounted | Check `oc exec deployment/mailpit -- env \| grep MP_DATABASE` and verify the volume mount |
