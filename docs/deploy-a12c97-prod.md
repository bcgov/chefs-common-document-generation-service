# Deploying CDOGS (Carbone Enterprise) to a12c97-prod

Runbook for the hand-run CDOGS deployment in the CHEFS namespace `a12c97-prod`.

This is **not** the CI path. GitHub Actions builds and deploys the same chart to
`2250c5-dev/test/prod` on every push to `master` (see `.github/workflows/on-push.yaml`).
The `a12c97-*` deployment has no pipeline credentials and is deployed by hand from the
devcontainer.

| | |
|---|---|
| Namespace | `a12c97-prod` |
| Helm release | `master` |
| Chart | `charts/cdogs` (bundles `charts/carbone-ee` as the `carbone` subchart) |
| Branch | `enterprise` |
| Public route | `chefs-cdogs.apps.silver.devops.gov.bc.ca` |
| Image | built in-namespace by `bc/chefs-cdogs-build` → `chefs-cdogs:latest` |

The deployment is a normal Helm release. Deploys are `helm upgrade`; there is no
delete-and-reimport step, and nothing is pasted into the OpenShift console.

---

## 1. Prerequisites

### Tools

`helm` (3.17+) and `oc` are not in the devcontainer image, so they need installing after a
rebuild:

```bash
# helm
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# oc + kubectl (arm64 devcontainer; swap arm64 → amd64 on an Intel host)
curl -fsSL -o /tmp/oc.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/arm64/clients/ocp/stable/openshift-client-linux-arm64-rhel9.tar.gz
tar -xzf /tmp/oc.tar.gz -C /usr/local/bin oc kubectl
chmod +x /usr/local/bin/oc /usr/local/bin/kubectl
```

### Secrets that must already exist

The chart references these but does not create them. Both are `lookup`-guarded, so Helm
leaves them alone entirely.

| Secret | Used by | Keys |
|---|---|---|
| `carbone-license` | carbone DC → `CARBONE_EE_LICENSE` | `license` |
| `common-document-generation-service-keycloak` | cdogs DC → `KC_CLIENTID`, `KC_CLIENTSECRET` | `username`, `password` |

`values.prod.yaml` sets `features.authentication: true` while `KC_ENABLED` is `"false"`, and
the template branches on *either* — so the Keycloak env refs are rendered even though auth is
off, and the secret must exist or the pod lands in `CreateContainerConfigError`.

The Carbone license lives here and nowhere else: it is read from the cluster, never supplied
by the chart. A local `carbone-license.txt` is only for running Carbone in the devcontainer
and has no bearing on a deployment.

#### Checking they exist

Both secrets present:

```bash
oc -n a12c97-prod get \
  secret/carbone-license \
  secret/common-document-generation-service-keycloak
```

A missing one reports `Error from server (NotFound)`. Presence alone is not enough, though —
a secret that exists but lacks an expected key fails the same way at pod start, so check the
keys too:

```bash
for s in carbone-license common-document-generation-service-keycloak; do
  echo "$s:"
  oc -n a12c97-prod get secret/$s \
    -o go-template='{{range $k,$v := .data}}  - {{$k}}{{"\n"}}{{end}}'
done
```

Expected:

```
carbone-license:
  - license
common-document-generation-service-keycloak:
  - password
  - username
```

To confirm a key is populated rather than empty, check its length — this reports byte counts
without printing the secret itself:

```bash
NS=a12c97-prod
for s in carbone-license:license \
         common-document-generation-service-keycloak:username \
         common-document-generation-service-keycloak:password; do
  name=${s%%:*}; key=${s##*:}
  len=$(oc -n $NS get secret/$name -o jsonpath="{.data.$key}" 2>/dev/null | base64 -d 2>/dev/null | wc -c)
  if [ "$len" -gt 0 ]; then echo "  OK       $name → $key ($len bytes)"; else echo "  MISSING  $name → $key"; fi
done
```

> Avoid `oc get secret … -o yaml` or `-o custom-columns=…:.data` for these checks. Secret data
> is base64-encoded, not encrypted, so those commands print the live Carbone license and
> Keycloak password into your terminal and shell history. The forms above deliberately report
> only key names and byte counts.

---

## 2. Deploy

### 2.1 Log in

```bash
oc login --web --server=https://api.silver.devops.gov.bc.ca:6443
oc project a12c97-prod
helm -n a12c97-prod list --filter master
```

You should see release `master` in status `deployed`. If it is missing, stop — see
[Re-adopting a lost release](#7-re-adopting-a-lost-release).

### 2.2 Build chart dependencies

Required on every fresh clone; pulls `carbone-ee` into `charts/cdogs/charts/`.

```bash
git checkout enterprise
helm dependency build charts/cdogs
```

### 2.3 Preview

`--dry-run=server` renders against the live cluster so `lookup` behaves exactly as it will in
the real run. Diff the result against what is actually deployed:

```bash
helm upgrade --install master charts/cdogs \
  --namespace a12c97-prod \
  --values .github/environments/values.prod.yaml \
  --values .github/environments/values.a12c97-prod.yaml \
  --dry-run=server > /tmp/dry.yaml

awk '/^MANIFEST:/{f=1;next} /^NOTES:/{f=0} f' /tmp/dry.yaml > /tmp/manifest.yaml
oc -n a12c97-prod diff -f /tmp/manifest.yaml
```

A `generation:` bump with no other change is an artifact of `oc diff`'s dry-run apply, not a
real difference. Anything else is your actual change set.

### 2.4 Upgrade

```bash
helm upgrade --install master charts/cdogs \
  --namespace a12c97-prod \
  --values .github/environments/values.prod.yaml \
  --values .github/environments/values.a12c97-prod.yaml \
  --atomic --timeout 10m
```

Namespace-specific settings (image repository, route host, `CARBONE_URL`, pull policy,
allowed namespaces) live in `.github/environments/values.a12c97-prod.yaml`.

> Never put a12c97 settings in `values.prod.yaml` — CI passes that same file when deploying
> to `2250c5-prod`, so editing it changes the other production deployment too.

### 2.5 Watch the rollout — Helm will not

Helm's `--wait` only understands native workload kinds. Both workloads here are
`DeploymentConfig`, which Helm ignores, so `--wait` (and therefore `--atomic`) returns
success **without ever looking at the pods**. A failed rollout will be reported as
"Upgrade complete".

```bash
oc -n a12c97-prod rollout status dc/common-document-generation-service-master --watch
oc -n a12c97-prod rollout status dc/carbone-master --watch
```

### 2.6 Verify

```bash
oc -n a12c97-prod get pods -l app.kubernetes.io/instance=master
```

Then check the service is actually working, from inside a pod:

```bash
POD=$(oc -n a12c97-prod get pods -l app.kubernetes.io/name=common-document-generation-service \
  --field-selector=status.phase=Running -o name | head -1)

oc -n a12c97-prod exec $POD -- node -e '
Promise.all([
  fetch("http://localhost:3000/api/v2/health").then(r=>r.text()).then(t=>"health  -> "+t),
  fetch("http://carbone-master:4000/status").then(r=>r.text()).then(t=>"carbone -> "+t)
]).then(a=>a.forEach(x=>console.log(x))).catch(e=>console.log("ERR",e.message));'
```

Expected:

```
health  -> OK
carbone -> {"success":true,"code":200,"message":"OK","version":"5.11.0"}
```

Finally, confirm the cluster now matches the chart by re-running the `oc diff` from 2.3 —
only `generation:` lines should remain.

---

## 3. Shipping new application code

Builds and deploys are decoupled here, and **a new build does not deploy itself.**

The BuildConfig writes only to `chefs-cdogs:latest`, and the DeploymentConfig has just a
`ConfigChange` trigger — no ImageChange trigger. A rebuild under the same floating tag leaves
the DC spec identical, so Helm reports no change and nothing restarts.

```bash
# 1. build the current enterprise branch
oc -n a12c97-prod start-build chefs-cdogs-build --follow

# 2. roll it out (Helm will not do this for you)
oc -n a12c97-prod rollout latest dc/common-document-generation-service-master
oc -n a12c97-prod rollout status dc/common-document-generation-service-master --watch

# 3. confirm both replicas are on the same image
oc -n a12c97-prod get pods -l app.kubernetes.io/name=common-document-generation-service \
  --field-selector=status.phase=Running \
  -o jsonpath='{range .items[*]}{.metadata.name} {.status.containerStatuses[0].imageID}{"\n"}{end}'
```

Both digests must match. The `status.phase=Running` filter is not optional — completed
CronJob pods carry the same labels and will otherwise show up on whichever image they ran,
which reads as a false mismatch. `imagePullPolicy: Always` (set in the overlay) prevents a rescheduled
pod from coming up on a stale cached layer, but it does not make new builds roll themselves.

The CronJob needs no action — its pods are created fresh on each fire and resolve `latest` at
run time.

> **Known gap.** Because the tag floats, "what is in production" depends on rollout history
> rather than anything declared. The durable fix is to tag builds by commit SHA
> (`oc tag chefs-cdogs:latest chefs-cdogs:sha-<short>`) and set `image.tag` to that, so the DC
> spec changes whenever the code changes and `helm upgrade` rolls it automatically — the way
> CI does it. This requires a build-side change first; do not set a SHA tag before those tags
> exist or the DC will sit in `ImagePullBackOff`, and `--atomic` will not catch it.

---

## 4. Rollback

```bash
helm -n a12c97-prod history master
helm -n a12c97-prod rollback master <REVISION> --timeout 10m
oc -n a12c97-prod rollout status dc/common-document-generation-service-master --watch
```

To roll back only the application image, use `oc rollout undo dc/...` instead — that leaves
the Helm release untouched, which is what you want when the chart did not change.

---

## 5. What is in the release, and what is not

Nine objects are Helm-managed:

| Kind | Name |
|---|---|
| DeploymentConfig | `common-document-generation-service-master`, `carbone-master` |
| Service | `common-document-generation-service-master`, `carbone-master` |
| Route | `common-document-generation-service-master` |
| CronJob | `common-document-generation-service-master` |
| ConfigMap | `common-document-generation-service-config` |
| NetworkPolicy | `allow-openshift-ingress-to-common-document-generation-service-master-app` |
| NetworkPolicy | `allow-ingress-from-cdogs-app-to-carbone-app` |

These are **outside** the release and are never touched by a deploy:

| Kind | Name | Why |
|---|---|---|
| PersistentVolumeClaim | `carbone-pvc` | `lookup`-guarded; also `resource-policy: keep` |
| PersistentVolumeClaim | `common-document-generation-service-cache` | same |
| Secret | `carbone-license` | `lookup`-guarded, created out of band |
| Secret | `common-document-generation-service-keycloak` | same |
| NetworkPolicy | `allow-chefs2-to-cdogs` | hand-created, grants `acf456-*` |
| NetworkPolicy | `allow-from-openshift-ingress`, `allowed-policy` | namespace-level, platform-managed |

`carbone-pvc` holds Carbone's template and render storage. It is protected from Helm by
`helm.sh/resource-policy: keep`, but nothing protects it from a manual `oc delete` — which is
the main reason the old delete-and-reimport procedure was replaced.

> `allow-chefs2-to-cdogs` is now redundant: the chart's own policy grants `acf456-dev/test/prod`
> identically since `allowedNamespaces` was extended in the overlay. It can be deleted once
> confirmed, which removes the drift between declared and actual access.

### Listing them

```bash
oc -n a12c97-prod get dc,svc,route,networkpolicy,cronjob -l app.kubernetes.io/instance=master
```

That selector **under-reports**. The ConfigMap and both PVCs carry
`helm.sh/resource-policy: keep` *instead of* the standard labels (the templates branch one way
or the other on `config.releaseScoped`, which is `false` here), so they are invisible to it.
Query them by name:

```bash
oc -n a12c97-prod get \
  cm/common-document-generation-service-config \
  pvc/carbone-pvc pvc/common-document-generation-service-cache \
  secret/carbone-license secret/common-document-generation-service-keycloak
```

---

## 6. Network access

Two paths matter, both verified working:

- **CHEFS → CDOGS** over the internal service. `chefs-sc-config` holds
  `SC_CS_CDOGS_V3_ENDPOINT: http://common-document-generation-service-master.a12c97-prod:3000`.
  Permitted by the chart's NetworkPolicy (`a12c97-prod` on port 3000).
- **CDOGS → Carbone** via `CARBONE_URL: http://carbone-master:4000/`. Permitted by
  `allow-ingress-from-cdogs-app-to-carbone-app`, whose `podSelector` matches
  `app.kubernetes.io/instance=master` + `app.kubernetes.io/name=common-document-generation-service`.

Route traffic is covered by the namespace-level `allow-from-openshift-ingress`.

To change who may reach CDOGS, edit `networkPolicy.allowedNamespaces` in
`values.a12c97-prod.yaml` and redeploy. Do not edit the policy in the console — the next
deploy silently reverts it. Note the list is *replaced*, not merged, so it must name every
allowed namespace.

Because the service name is derived from the release name, **renaming the release would rename
the Service and break the CHEFS endpoint above.** Helm has no rename operation, so it would
also mean an uninstall/install cycle. Leave the release named `master`; it matches the
`job_name: master` convention the CI pipeline uses for the `2250c5-*` releases.

---

## 7. Re-adopting a lost release

Only needed if `helm list` no longer shows `master` — for example if the release secret was
deleted, or objects were recreated by hand.

Helm refuses to manage objects that lack its ownership annotations. The
`app.kubernetes.io/managed-by: Helm` label is already rendered by the chart; what is missing on
hand-created objects is the two `meta.helm.sh/*` annotations.

**Settle any drift first.** Run the `oc diff` from 2.3 and apply outstanding changes with `oc`
*before* adopting. This matters because of a trap:

> When no release exists, `helm upgrade --install` takes the **install** path. Pre-existing
> resources that pass the ownership check are adopted but **not patched** to match the
> manifest — yet Helm stores the full rendered manifest as revision 1, including changes it
> never applied. Every later upgrade then diffs revision N against N+1, finds them identical,
> sends an empty patch, and reports "Upgrade complete" while the cluster stays drifted. The
> drift becomes invisible to Helm and self-perpetuating; only `oc diff` reveals it.

Then stamp ownership:

```bash
NS=a12c97-prod; REL=master
for r in \
  networkpolicy/allow-ingress-from-cdogs-app-to-carbone-app \
  networkpolicy/allow-openshift-ingress-to-common-document-generation-service-master-app \
  configmap/common-document-generation-service-config \
  service/carbone-master \
  service/common-document-generation-service-master \
  cronjob/common-document-generation-service-master \
  dc/carbone-master \
  dc/common-document-generation-service-master \
  route/common-document-generation-service-master
do
  oc -n $NS annotate --overwrite $r \
    meta.helm.sh/release-name=$REL meta.helm.sh/release-namespace=$NS
  oc -n $NS label --overwrite $r app.kubernetes.io/managed-by=Helm
done
```

(`helm upgrade --install --take-ownership` does the same thing implicitly, but stamping
explicitly is reviewable and reversible.) The PVCs are deliberately absent from that list —
`lookup` finds them, so they are never part of the release.

Then run the upgrade from 2.4 **without `--atomic`**:

> With no prior release, `--install` performs an *install*, and `--atomic` cleans up a failed
> install by uninstalling it — which would delete the production DeploymentConfigs, Services,
> Route and NetworkPolicies it just adopted.

Afterwards, re-run `oc diff` and apply anything still outstanding by hand. Do not trust
"Upgrade complete" on an adoption run. Once the cluster and the recorded manifest agree,
normal `--atomic` upgrades work as expected.

---

## 8. Troubleshooting

**Helm reports success but nothing changed.** Compare the stored manifest to the render:

```bash
helm -n a12c97-prod get manifest master > /tmp/recorded.yaml
diff /tmp/recorded.yaml /tmp/manifest.yaml
```

If they are identical but `oc diff` shows differences, you are in the adoption trap described
in section 7 — apply the delta with `oc patch`/`oc apply` to bring the cluster back in line
with what Helm already believes it deployed.

**Helm wants dependencies built.**

```bash
helm dependency build charts/cdogs
```

**Pod stuck in `CreateContainerConfigError`.** One of the two secrets in section 1 is missing,
or exists but is missing a key. The event says which:

```bash
oc -n a12c97-prod describe pod <pod> | grep -A3 -i "createcontainerconfig\|secret"
```

Then re-run the secret checks in section 1.

**Carbone pod logs show Chrome OOM-score errors.** Benign under OpenShift's restricted SCC;
the converter still reports ready. Confirm with `chrome converter is ready` in the log.

**Cache cleaner CronJob.** Runs `node ./cacheCleaner.js` from the CDOGS image at 00:00 UTC on
Mondays and Thursdays.

```bash
oc -n a12c97-prod get cronjob/common-document-generation-service-master
oc -n a12c97-prod get jobs -l app.kubernetes.io/instance=master
```
