# PRO-CODE — container delivery and release

## Working deployment boundary

The Docker image includes the built React cockpit and the real Node automatic Nexus runtime. The build executes lint, type checking, Node/Vitest tests, and the production bundle build. The container starts as an unprivileged user, with a Docker health probe and writable paths isolated to workspace and runtime data.

The Nexus API currently has no trusted remote authentication boundary and permits broad CORS. **Never expose its port directly to an untrusted network.** Bind Docker's published host port to loopback as below. To provide remote access, place an independently authenticated reverse proxy, an authorization boundary, transport security, and threat-specific tests ahead of the runtime before widening access.

## Run a published, immutable revision locally

After a successful main-branch container release, take the image digest from its GitHub Actions job summary. Prefer the digest over the mutable `main` tag:

```sh
docker pull ghcr.io/glaciereq/pro-code@sha256:REPLACE_WITH_VERIFIED_DIGEST
docker volume create pro-code-data
docker run --detach --name pro-code \
  --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount type=volume,source=pro-code-data,target=/data \
  --mount type=bind,source="$PWD",target=/workspace,readonly \
  --publish 127.0.0.1:8787:8787 \
  ghcr.io/glaciereq/pro-code@sha256:REPLACE_WITH_VERIFIED_DIGEST
curl --fail --silent http://127.0.0.1:8787/health
```

The read-only bind mount is optional; replace it with the workspace to inventory. Avoid mounting sensitive directories unless that scope is expressly intended. Runtime reports and manifests live in the named volume. The runtime's workspace scanner may read configured files; it does not authenticate or authorize external remote requests.

## Release lifecycle

1. Pull request: container builds from the exact checkout and executes source checks plus live HTTP tests. No registry publication occurs from pull requests.
2. Merge via a non-squash merge after CI succeeds.
3. Main push: rebuild, rerun the same smoke test, then publish the **same tested local image** as `ghcr.io/glaciereq/pro-code:sha-<full commit>` and `:main`.
4. Record the source SHA, GitHub Actions run, pushed digest, and local /health response. Successful image publication is not proof that an external host was updated.
5. Remote rollout is separate: pull the immutable digest on the authorized target, restart the service, inspect its real health and contract behavior, and retain the previous working digest for recovery.

## Repair and rollback

```sh
docker logs --tail 100 pro-code
docker inspect --format '{{json .State.Health}}' pro-code
docker stop pro-code && docker rm pro-code
# Rerun the command above with the last known-good immutable digest.
```

Preserve the named volume during application replacement. A deployment is not verified until its exact target digest and HTTP readback are observed.
