import type { UserInstructionConfigService } from "@cline/sdk";
import {
  createUserInstructionConfigService,
  resolvePluginSkillDirectoriesFromPaths,
} from "@cline/sdk";

type StartUserInstructionServiceInput = {
  cwd: string;
  pluginPaths: string[];
  sessionId: string;
  workspaceRoot: string;
};

type UserInstructionServiceFactory = typeof createUserInstructionConfigService;

export class BlameUserInstructionServices {
  private readonly createService: UserInstructionServiceFactory;
  private readonly services = new Map<string, UserInstructionConfigService>();

  constructor(
    createService: UserInstructionServiceFactory = createUserInstructionConfigService,
  ) {
    this.createService = createService;
  }

  async start(input: StartUserInstructionServiceInput) {
    const service = this.createService({
      skills: {
        workspacePath: input.workspaceRoot,
        pluginSkillDirectories: resolvePluginSkillDirectoriesFromPaths(
          input.pluginPaths,
        ),
      },
      rules: { workspacePath: input.cwd },
      workflows: { workspacePath: input.cwd },
    });
    try {
      await service.start();
    } catch {
      service.stop();
      return undefined;
    }
    this.stop(input.sessionId);
    this.services.set(input.sessionId, service);
    return service;
  }

  stop(sessionId: string) {
    this.services.get(sessionId)?.stop();
    this.services.delete(sessionId);
  }

  stopAll() {
    this.services.forEach((service) => service.stop());
    this.services.clear();
  }
}
