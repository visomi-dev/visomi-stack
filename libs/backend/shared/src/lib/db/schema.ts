// Keep the complete schema discovery surface stable for Drizzle and existing consumers.
// Feature modules depend directly on schema-auth, never on this discovery entry point.
export {
  accounts,
  accountMemberships,
  apiKeys,
  authEmailChallenges,
  authIdentityFlows,
  userTotpEnrollments,
  userRecoveryCodes,
  authOperationGrants,
  authDeviceApprovalRequests,
  userFederatedIdentities,
  authAuditEvents,
  authEnrollmentGrants,
  authVerificationChallenges,
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accountWebAuthnChallenges,
  userActivationMilestones,
  userSessions,
  userDevices,
  users,
} from './schema-auth';
export {
  asyncJobs,
  projectDocuments,
  projects,
  opaqueSyncCursors,
  opaqueSyncEnvelopes,
  opaqueSyncTombstones,
  opaqueSyncCheckpoints,
  encryptedContextMetadata,
  encryptedContextTombstones,
  syncDevices,
  syncWorkspaceVersions,
  syncWorkspaceApprovals,
  syncDeviceGrants,
  syncDeviceAudit,
} from './schema-sync';
export {
  pushDeliveries,
  pushSubscriptions,
  notificationInbox,
  notificationPreferences,
  durableOperations,
} from './schema-activity';
export { vaultBrowserEnrollments, vaultUnlockAssertions, vaultUnlockMethods, vaultPinProfiles } from './schema-vault';
