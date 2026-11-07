# TovarNet Labs · ATLAS on Coolify
**Checkpoint:** 2026-11-06

## Deployment model
This fork is deployed through Coolify from Git.

- Coolify project: `TNL - Laboratorio`
- Environment: `production`
- Resource: `ATLAS - Gods Eye View`
- Repository: `tovarnet/gods-eye-view`
- Branch: `feature/mexico-transit`
- Build pack: Docker Compose from Git
- Compose path: `/compose.coolify.yaml`
- Raw Compose: disabled
- Runtime service: `atlas`
- Internal port: 4173

## Private loopback access
`compose.coolify.yaml` publishes only:

```
127.0.0.1:${ATLAS_LOOPBACK_PORT:-4174}:4173
```

The tested operator tunnel is:

```bash
ssh -N -L 4174:127.0.0.1:4174 tovarnet@2.25.110.55
```

Then open:

`http://127.0.0.1:4174`

This path was validated with the running Coolify deployment.

## Environment
Expected runtime configuration:

- `GEV_ALLOWED_HOSTS=atlas.tovarnet.com.mx`
- `ATLAS_LOOPBACK_PORT=4174` or Compose default 4174
- `GEV_KEY_SETUP_TRUSTED_PEERS`: empty/unset so the Docker launcher can resolve the local gateway. Do not force `none` when local tunnel provider setup is required.

Secrets/API keys must remain outside Git.

## Mexico Transit validation
The running Coolify deployment was opened over the private tunnel and the native `metrobus-cdmx` layer rendered successfully:

- 7 lines
- 89 route variants
- 378 stations
- LOD station rendering

Phase 1 remains static; no live Metrobús vehicles are included yet.

## Public domain status
Coolify has the intended route:

`https://atlas.tovarnet.com.mx` → service `atlas` → port 4173.

At checkpoint time the UI showed **Changes pending**, so the public-domain change was not yet considered final.

Before public redeploy:
1. disable search-engine indexing;
2. keep `atlas.tovarnet.com.mx` canonical and review/remove or redirect `www.atlas.tovarnet.com.mx`;
3. attach existing Traefik file middleware `tnl-authelia-auth@file` to Coolify-generated routers;
4. inspect the deployable Compose / generated labels;
5. redeploy;
6. verify HTTPS, Authelia 2FA, ATLAS, Metrobús and the private tunnel.

## Operational rule
Coolify owns deployment and lifecycle. Portainer is observation-only. Do not recreate this deployment manually with `docker compose up` on the host.
