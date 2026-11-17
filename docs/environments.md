# Environment separation

Spire has three deployment environments. They must not share database
credentials.

| Environment | Vercel scope | Database | Migrations |
|---|---|---|---|
| Production | `production` | Production Supabase project | Applied during the production build |
| Preview | `preview` | A separate Supabase project or branch | Skipped unless explicitly confirmed |
| Local | none | Local or dedicated development project | Applied by `pnpm db:migrate` |

## Production

Set these as **Production** environment variables in Vercel:

- `POSTGRES_URL` — session pooler URI (port 5432), used only by migrations.
- `POSTGRES_TRANSACTION_URL` — transaction pooler URI (port 6543), used by the app.
- `AUTH_SECRET`, provider keys, storage credentials, and the other values from `.env.example`.

Production deployments run migrations because `VERCEL_ENV=production`.

## Preview

Create a separate Supabase project or database branch for Preview. Set
**Preview-scoped** values for:

- `POSTGRES_URL`
- `POSTGRES_TRANSACTION_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STORAGE_PROVIDER` and the matching storage credentials
- `AUTH_SECRET` — a different secret from production

Then set `PREVIEW_DATABASE_CONFIRMED=true` only after verifying that the Preview
`POSTGRES_URL` points at the preview database. Without that flag, preview builds
skip migrations and log the reason.

Never copy the production service-role key into Preview.

## Local

`.env.local` may point at a local Postgres or a dedicated development project.
`pnpm db:migrate` runs locally. Do not point a developer `.env.local` at the
production database.

## Verifying the target

`pnpm db:target` prints the database host and database name without printing
credentials, plus whether the current environment would run migrations.

## Applying migrations manually

Production migrations run during the Vercel build. If a migration must be
applied outside a deployment, run it from a machine whose `.env.local` points at
the production session pooler:

```powershell
pnpm db:migrate
```

`RUN_DB_MIGRATIONS=false` disables migrations for a single build. In Preview,
`PREVIEW_DATABASE_CONFIRMED` must also be `true`, so a copied production
credential still does not migrate by accident.
