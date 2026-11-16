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
