Yes, changing or replacing the Persistent Volume Claim (PVC) is highly likely the exact reason the database wasn't created.

When you use official PostgreSQL images, the initial setup script (which creates default databases, users, and passwords from your environment variables) **only runs if the data directory is completely empty**.

Here is why your new PVC might be causing this error, along with how to check it:

### 1. The PVC is Not Empty (`lost+found`)

If your new PVC was provisioned with a default `lost+found` folder at its root, PostgreSQL sees that the directory isn't strictly "empty" and completely skips the initialization phase. Because it skips initialization, it won't execute your environment variables to create the `sourcery` database.

You can verify this by looking at what happened when your pod started. Check your pod's logs for a message like:

> `PostgreSQL database directory appears to contain a database; Skipping initialization`

### 2. How to Fix It

If you want the container to initialize properly on this new PVC, you have two options depending on how your template is configured:

* **Use a Subpath:** Update your Deployment configuration to mount the volume using a `subPath`, which forces Postgres to isolate its data in an entirely clean subdirectory.
```yaml
volumeMounts:
  - name: sourcery-db-storage
    mountPath: /var/lib/postgresql/data
    subPath: pgdata

```


* **Change the PGDATA Variable:** Alternatively, ensure your `PGDATA` environment variable points to a deeper subfolder inside the mount so it avoids the root directory completely:
```yaml
env:
  - name: PGDATA
    value: /var/lib/postgresql/data/pgdata

```



---

### A Quick Diagnostic Check

Looking at your terminal, you successfully connected as the default root superuser `postgres` but were rejected because the database itself doesn't exist. To see exactly what databases *did* get created (or if it just defaulted to the standard system template), you can connect to the default system database by running:

```bash
psql -U postgres -d postgres

```

Once inside, type `\l` to list all existing databases. If you only see `postgres`, `template1`, and `template0`, the initialization script definitely skipped your custom environment variables due to the volume swap.