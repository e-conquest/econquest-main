# Running EconQuest on Kubernetes (Helm)

The chart in [`deploy/helm/econquest/`](../deploy/helm/econquest/) runs the app as **one pod**
with one persistent volume. The app keeps every bit of state in files under `/app/data`
(settings, saved keys, accounts, reports, the pull archive), so it does not scale out: never run
two copies against the same volume. Upgrades stop the old pod before starting the new one.

For a single always-on machine, [HOME_SERVER.md](HOME_SERVER.md) (Docker compose) is simpler. Use
this chart when you already run a cluster (k3s, kind, a managed cluster).

## What you need

- A cluster with a default storage class (or set `persistence.storageClass`).
- Helm 3.
- The image in a registry the cluster can pull from. No public image is published:

  ```sh
  docker build -t registry.example.com/econquest:main .
  docker push registry.example.com/econquest:main
  ```

  On k3s you can skip the registry: `docker save econquest:local | sudo k3s ctr images import -`.
- An Ollama the pod can reach, with `qwen2.5:7b` and `qwen2.5:32b` pulled. The referee steps use
  the 32B model, never an 8B one. Ollama can run in the cluster (with a GPU node) or on another
  machine on your network.

## Install

1. Make the master key that encrypts keys saved in Menu > Settings (keep a copy elsewhere), plus
   any data keys you want set from the start:

   ```sh
   kubectl create namespace econquest
   kubectl -n econquest create secret generic econquest-keys \
     --from-literal=ECONQUEST_SECRET_KEY="$(openssl rand -base64 32)"
   ```

2. Install, naming the image, the secret and your Ollama:

   ```sh
   helm install econquest deploy/helm/econquest -n econquest \
     --set image.repository=registry.example.com/econquest --set image.tag=main \
     --set secret.existingSecret=econquest-keys \
     --set ollama.baseUrl=http://192.168.1.30:11434
   ```

   To reach it by name through your ingress controller, add
   `--set ingress.enabled=true --set ingress.host=econquest.example.com`
   (and `--set ingress.tlsSecretName=...` for HTTPS). The host is added to the app's allowed host
   names, and the app trusts the ingress's forwarded headers.

3. Sign-in is always on in a cluster. Read the one-time setup code from the log and create the
   first admin account on the sign-in page:

   ```sh
   kubectl -n econquest logs deploy/econquest | grep -i "setup code"
   ```

4. Without an ingress, open it with a port forward: `kubectl -n econquest port-forward svc/econquest 3737:3000`,
   then http://127.0.0.1:3737/.

## Checks

The pod's probes use `/healthz` (the process answers) and `/readyz` (it can serve and write the data
folder). `kubectl -n econquest get pods` should show `1/1 Running`.

## Settings

Everything is in [`values.yaml`](../deploy/helm/econquest/values.yaml), each with a comment. The ones
you are most likely to change: `image`, `ollama`, `timeZone`, `schedule` (the nightly data download
and weekly backtests), `allowedHosts`, `persistence.size` (offline data and GDELT files grow; 20 Gi
is a start), `extraEnv` for any plain setting from `.env.example`, and `secret` for keys.

## Backups and upgrades

Back up the volume (`<release>-data`); it is kept when you uninstall the release. Menu > Backup
works too, and never includes keys. To upgrade, build and push a new image tag, then
`helm upgrade econquest deploy/helm/econquest -n econquest --reuse-values --set image.tag=<new>`.
