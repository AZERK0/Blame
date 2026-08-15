import type { ClineCore, CoreSessionConfig } from "@cline/sdk";
import { randomUUID } from "node:crypto";

import {
  legacyDirectWorkspaceTools,
  readTools,
  writeTools,
} from "./cline-tool-policy.js";
import {
  semanticWorkspaceReadToolNames,
  semanticWorkspaceTools,
} from "./harness/cline-tools.js";
import { loadPrompt } from "./prompt-loader.js";
import { appendProductionConfig } from "./production.js";
import { reasoningConfig } from "./reasoning.js";
import {
  mergeSecurityCandidates,
  parseSecurityDiscovery,
  parseSecurityValidation,
  securityDiscoveryPrompt,
  securityValidationPrompt,
} from "./security-audit.js";
import {
  securityDiscoveryResultSchema,
  securityValidationResultSchema,
} from "./security-audit-schema.js";
import type {
  DiscoverSecurityAuditInput,
  SecurityAuditDiscoveryResult,
  ValidateSecurityAuditInput,
  ValidateSecurityAuditResult,
} from "./types.js";

type AgentTool = NonNullable<CoreSessionConfig["extraTools"]>[number];
type Credential = {
  apiKey: string;
  authMethod?: string;
  baseUrl: string | null;
};
type Correction = { previousResult: string; validationError: string };
type RuntimeResult = { sessionId: string };

export type SecurityAuditSessionControl = {
  assertActive(): void;
  finished(sessionId: string): void;
  started(sessionId: string, cline: ClineCore): void;
};

const maxAttempts = 3;
const securityAuditReadTools = new Set([
  "workspace_state",
  "search_code",
  "outline_code",
  "inspect_code",
]);

export async function runSecurityDiscovery(
  cline: ClineCore,
  input: DiscoverSecurityAuditInput,
  credential: Credential,
  control?: SecurityAuditSessionControl,
): Promise<SecurityAuditDiscoveryResult> {
  let correction: Correction | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    control?.assertActive();
    const submit = submitTool(
      "submit_security_discovery",
      "Submit all security discovery candidates and coverage evidence.",
      securityDiscoveryResultSchema,
    );
    const session = await startAuditAgent(
      cline,
      input,
      credential,
      submit.tool,
      securityDiscoveryPrompt(input.repository, input.perspective, correction),
      "security-audit-discovery-system",
      "blame-security-discovery",
      input.mode === "deep" ? 40 : 28,
      control,
    );
    try {
      if (!submit.input)
        throw new Error("Security discovery did not submit a result");
      return parseSecurityDiscovery(
        submit.input,
        session.sessionId,
        input.perspective,
      );
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      correction = correctionFrom(submit.input, error);
    }
  }
  throw new Error("Security discovery did not return a valid result");
}

export async function runSecurityValidation(
  cline: ClineCore,
  input: ValidateSecurityAuditInput,
  credential: Credential,
  control?: SecurityAuditSessionControl,
): Promise<ValidateSecurityAuditResult> {
  let correction: Correction | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    control?.assertActive();
    const submit = submitTool(
      "submit_security_validation",
      "Submit confirmed findings and rejected candidates.",
      securityValidationResultSchema,
    );
    const session = await startAuditAgent(
      cline,
      input,
      credential,
      submit.tool,
      securityValidationPrompt(
        input.repository,
        mergeSecurityCandidates(input.discoveries),
        correction,
      ),
      "security-audit-validation-system",
      "blame-security-validation",
      input.mode === "deep" ? 48 : 32,
      control,
    );
    try {
      if (!submit.input)
        throw new Error("Security validation did not submit a result");
      return parseSecurityValidation(
        submit.input,
        session.sessionId,
        input.repository,
        input.discoveries,
      );
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      correction = correctionFrom(submit.input, error);
    }
  }
  throw new Error("Security validation did not return a valid result");
}

async function startAuditAgent(
  cline: ClineCore,
  input: DiscoverSecurityAuditInput | ValidateSecurityAuditInput,
  credential: Credential,
  resultTool: AgentTool,
  prompt: string,
  systemPrompt: string,
  source: string,
  maxIterations: number,
  control?: SecurityAuditSessionControl,
) {
  control?.assertActive();
  const sessionId = `security-${randomUUID()}`;
  control?.started(sessionId, cline);
  try {
    return (await cline.start({
      prompt,
      config: auditConfig(
        input,
        credential,
        resultTool,
        systemPrompt,
        maxIterations,
        sessionId,
      ),
      interactive: false,
      source,
      toolPolicies: auditToolPolicies(resultTool.name),
    })) as RuntimeResult;
  } finally {
    control?.finished(sessionId);
  }
}

function auditConfig(
  input: DiscoverSecurityAuditInput | ValidateSecurityAuditInput,
  credential: Credential,
  resultTool: AgentTool,
  systemPrompt: string,
  maxIterations: number,
  sessionId: string,
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    ...reasoningConfig(input.reasoningEffort),
    sessionId,
    systemPrompt: loadPrompt(systemPrompt),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    extraTools: [
      ...semanticWorkspaceTools(input.workspaceRoot, {
        redactSensitiveContent: true,
      }).filter((tool) => securityAuditReadTools.has(tool.name)),
      resultTool,
    ],
    maxIterations,
  });
}

function submitTool(
  name: string,
  description: string,
  inputSchema: AgentTool["inputSchema"],
) {
  const submit: { input?: unknown; tool: AgentTool } = {
    tool: {
      name,
      description,
      inputSchema,
      lifecycle: { completesRun: true },
      execute(input: unknown) {
        submit.input = input;
        return { accepted: true };
      },
    },
  };
  return submit;
}

function auditToolPolicies(resultToolName: string) {
  return Object.fromEntries([
    [resultToolName, { autoApprove: true }],
    ...legacyDirectWorkspaceTools.map((name) => [
      name,
      { enabled: false, autoApprove: false },
    ]),
    ...readTools.map((name) => [name, { enabled: false, autoApprove: false }]),
    ...writeTools.map((name) => [name, { enabled: false, autoApprove: false }]),
    ...semanticWorkspaceReadToolNames
      .filter((name) => securityAuditReadTools.has(name))
      .map((name) => [name, { enabled: true, autoApprove: true }]),
  ]);
}

function correctionFrom(previousResult: unknown, error: unknown): Correction {
  return {
    previousResult: JSON.stringify(previousResult) ?? String(previousResult),
    validationError: error instanceof Error ? error.message : String(error),
  };
}
