/**
 * Build-time flag for the documentation prototype.
 *
 * The prototype deliberately runs the real React route tree with local fixtures. It is
 * never enabled for the normal Electron, Android, iOS, or Web builds.
 */
export const isOfflineDemo = process.env.BIU_OFFLINE_DEMO === "true";
