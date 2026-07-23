To run **Mailpit** on OpenShift with persistent storage and single-user basic authentication for the Web UI, you can use the official `axllent/mailpit` Docker image along with an OpenShift `Secret` (for `htpasswd` credentials) and a `PersistentVolumeClaim` (PVC).

---

## Required Environment Variables

| Variable | Recommended Value | Purpose |
| --- | --- | --- |
| **`MP_DATABASE`** | `/data/mailpit.db` | Points SQLite to a file on your mounted PVC volume so messages persist across pod restarts. |
| **`MP_UI_AUTH_FILE`** | `/etc/mailpit/htpasswd` | Path to the basic auth file mounted from an OpenShift Secret. |
| **`MP_MAX_MESSAGES`** | `1000` (or `0` to disable) | Maximum number of emails to retain in the database before auto-deleting old ones. |

---

## Step-by-Step Implementation

### 1. Create the `htpasswd` Auth Secret

Mailpit uses standard `htpasswd` files for basic authentication. Create the password file locally and upload it as a Secret:

```bash
# Create local htpasswd file (BCrypt or MD5/SHA)
htpasswd -B -c ./htpasswd demo_user

# Store in OpenShift as a Secret
oc create secret generic mailpit-auth --from-file=htpasswd=./htpasswd

```

---

### 2. Create the Persistent Volume Claim (PVC)

Save as `mailpit-pvc.yaml` and apply (`oc apply -f mailpit-pvc.yaml`):

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

---

### 3. Deploy Mailpit

Save as `mailpit-deployment.yaml` and apply (`oc apply -f mailpit-deployment.yaml`):

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
    type: Recreate # Ensures single-pod lock on the persistent database file
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

---

### 4. Create Services and Web UI Route

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

---

### Connecting Your Demo App

* **SMTP Host:** `mailpit` (or `mailpit.<namespace>.svc.cluster.local`)
* **SMTP Port:** `1025`
* **Web UI Access:** Access via the generated OpenShift Route URL (`oc get route mailpit-ui`). Prompting for credentials will require the username and password created with `htpasswd`.