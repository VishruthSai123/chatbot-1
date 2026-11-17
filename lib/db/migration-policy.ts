/**
 * Decides whether a build may apply database migrations.
 *
 * Preview builds used to share production credentials, so a preview branch
 * could alter the production schema. This policy keeps migrations on the
 * production deployment and on a developer's machine, and makes a preview
 * build prove that it points at a preview database before it may migrate.
 *
 * Pure so the rules can be unit-tested without a database.
 */

export type MigrationEnvironment = {
  VERCEL_ENV?: string;
  RUN_DB_MIGRATIONS?: string;
  PREVIEW_DATABASE_CONFIRMED?: string;
};

export type MigrationDecision = {
  reason: string;
  run: boolean;
};

export function migrationDecision(
  environment: MigrationEnvironment
): MigrationDecision {
  if (environment.RUN_DB_MIGRATIONS === "false") {
    return { reason: "RUN_DB_MIGRATIONS=false", run: false };
  }

  const vercelEnvironment = environment.VERCEL_ENV?.trim();

  if (!vercelEnvironment) {
    return environment.RUN_DB_MIGRATIONS === "true"
      ? { reason: "local explicit opt-in", run: true }
      : { reason: "local development", run: true };
  }

  if (vercelEnvironment === "production") {
    return { reason: "production deployment", run: true };
  }

  if (vercelEnvironment === "preview") {
    if (environment.PREVIEW_DATABASE_CONFIRMED === "true") {
      return { reason: "preview database confirmed", run: true };
    }
    return {
      reason:
        "preview builds require PREVIEW_DATABASE_CONFIRMED=true and preview database credentials",
      run: false,
    };
  }

  return environment.RUN_DB_MIGRATIONS === "true"
    ? { reason: "non-production explicit opt-in", run: true }
    : { reason: `${vercelEnvironment} deployment`, run: false };
}
