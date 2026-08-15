export type DeploymentCompatibilityStatus =
  | "supported"
  | "conditional"
  | "unsupported";

export type DeploymentDiagnostic = {
  code: string;
  message: string;
  action?: string;
};

export type DeploymentManifest = {
  provider: "vercel";
  rootDirectory: string;
  framework: string | null;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  runConfigurationId?: string;
  previewServiceId?: string;
  requiredEnvironmentKeys: string[];
  compatibility: {
    status: DeploymentCompatibilityStatus;
    blockers: DeploymentDiagnostic[];
    warnings: DeploymentDiagnostic[];
  };
};

export type DeploymentStatus =
  | "preflighting"
  | "awaiting_confirmation"
  | "packaging"
  | "uploading_source"
  | "transferring_to_vercel"
  | "submitted"
  | "building"
  | "verifying_public_access"
  | "ready"
  | "protected"
  | "unhealthy"
  | "canceling"
  | "canceled"
  | "failed";

export type DeploymentSnapshot = {
  sourceRevision: string;
  sourceBranch: string | null;
  detached: boolean;
  workspaceHash: string;
  manifestHash: string;
  localChangeCount: number;
  fileCount: number;
  sourceBytes: number;
};

export type DeployConnectionStatus =
  | "active"
  | "disabled"
  | "permission_pending"
  | "removed"
  | "invalid";

export type DeployConnection = {
  id: string;
  provider: "vercel";
  scopeType: "personal" | "team";
  scopeDisplayName: string;
  status: DeployConnectionStatus;
  createdAt: string;
  updatedAt: string | null;
};

export type DeployProject = {
  id: string;
  name: string;
  framework: string | null;
};

export type DeployTarget = {
  id: string;
  projectId: string;
  connectionId: string;
  providerProjectId: string | null;
  providerProjectName: string;
  rootDirectory: string;
  framework: string | null;
  productionUrl: string | null;
  manifest: DeploymentManifest;
  createdAt: string;
  updatedAt: string | null;
};

export type ProjectDeployment = {
  id: string;
  projectId: string;
  targetId: string;
  operationId: string;
  status: DeploymentStatus;
  providerState: string | null;
  sourceRevision: string;
  sourceBranch: string | null;
  localChangeCount: number;
  fileCount: number;
  sourceBytes: number;
  deploymentUrl: string | null;
  productionUrl: string | null;
  errorCode: string | null;
  safeErrorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  readyAt: string | null;
  updatedAt: string | null;
};
