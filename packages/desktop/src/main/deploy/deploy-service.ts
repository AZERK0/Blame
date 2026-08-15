import type { ProjectDeployment } from "@blame/deploy-contract";
import {
  buildDeploySource,
  preflightDeploySource,
  type DeployPreflightInput,
} from "./deploy-source.ts";
import {
  CloudDeployClient,
  type CloudDeployConnection,
  uploadDeploySource,
} from "./cloud-deploy-client.ts";

export type DeployProgress = {
  phase: "preparing" | "uploading" | "submitting";
  percent: number;
};

export class DeployService {
  private cloud?: CloudDeployClient;

  constructor(private readonly packaged: boolean) {}

  configure(connection: CloudDeployConnection) {
    this.cloud = new CloudDeployClient(connection, this.packaged);
  }

  disconnect() {
    this.cloud = undefined;
  }

  preflight(input: DeployPreflightInput) {
    return preflightDeploySource(input);
  }

  async deploy(
    input: DeployPreflightInput & {
      projectId: string;
      targetId: string;
      operationId: string;
      expectedWorkspaceHash: string;
    },
    onProgress: (progress: DeployProgress) => void,
  ): Promise<ProjectDeployment> {
    const client = this.cloudClient();
    onProgress({ phase: "preparing", percent: 5 });
    const source = await buildDeploySource(input, input.expectedWorkspaceHash);
    onProgress({ phase: "preparing", percent: 30 });
    const prepared = await client.create({
      projectId: input.projectId,
      targetId: input.targetId,
      operationId: input.operationId,
      snapshot: source.snapshot,
      manifest: source.manifest,
      archive: { sha256: source.archiveSha256, size: source.archiveBytes },
    });
    if (!prepared.upload) {
      onProgress({ phase: "submitting", percent: 100 });
      return prepared.deployment;
    }
    onProgress({ phase: "uploading", percent: 45 });
    await uploadDeploySource(prepared.upload, source.content);
    onProgress({ phase: "submitting", percent: 75 });
    const completed = await client.complete(
      input.projectId,
      prepared.deployment.id,
      prepared.upload.artifactId,
    );
    onProgress({ phase: "submitting", percent: 100 });
    return completed.deployment;
  }

  private cloudClient() {
    if (!this.cloud) throw new Error("Deployment service is not connected");
    return this.cloud;
  }
}
