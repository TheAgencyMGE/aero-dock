/**
 * Outward links, in one place so the dock window and the settings window
 * cannot drift apart on what they point at.
 *
 * Everything here opens in the user's own browser through `ipc.launch`,
 * which hands the URL to the shell. Nothing external is ever embedded in
 * one of Aero Dock's own windows.
 */

export const REPO_URL = "https://github.com/TheAgencyMGE/aero-dock";
export const ISSUES_URL = "https://github.com/TheAgencyMGE/aero-dock/issues";
export const KOFI_URL = "https://ko-fi.com/theagencymge";
