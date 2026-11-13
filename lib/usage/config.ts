/**
 * Scale-rail switches.
 *
 * `USAGE_RAILS_ENABLED` stays off until the usage migration is applied. This
 * keeps local Live testing working during the transition. Production should set
 * it to `true` and fail closed if the tables are missing.
 *
 * `LIVE_ENABLED=false` is the emergency stop for new Live sessions. It does not
 * end sessions already in progress.
 */
export function usageRailsEnabled(): boolean {
  if (process.env.USAGE_RAILS_ENABLED === "false") {
    return false;
  }
  if (process.env.USAGE_RAILS_ENABLED === "true") {
    return true;
  }
  // Fail closed in production; keep local Live testing unblocked before the
  // migration is applied.
  return process.env.NODE_ENV === "production";
}

export function liveEnabled(): boolean {
  return process.env.LIVE_ENABLED !== "false";
}

/**
 * Chat quota rollout switch. Keep this off until the plan limits are approved
 * and existing users have been grandfathered.
 */
export function chatQuotaEnabled(): boolean {
  return process.env.CHAT_QUOTA_ENABLED === "true";
}

export function toolsQuotaEnabled(): boolean {
  return process.env.TOOLS_QUOTA_ENABLED === "true";
}

export function downloadQuotaEnabled(): boolean {
  return process.env.DOWNLOAD_QUOTA_ENABLED === "true";
}

export function uploadQuotaEnabled(): boolean {
  return process.env.UPLOAD_QUOTA_ENABLED === "true";
}
