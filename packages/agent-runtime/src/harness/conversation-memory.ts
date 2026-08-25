import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import {
  continuityFallbackMetrics,
  parseContinuityUpdate,
  type ContinuityMergeMetrics,
  type ContinuityUpdate,
  type DeterministicFallbackMemory,
  type MemoryEvidence,
  type MemoryScope,
  type ProposedMemoryFact,
  type StoredMemoryFact,
} from "./continuity-schema.js";
import { sha256 } from "./protocol.js";
import { ReadWorkingSet } from "./read-working-set.js";

export type MemoryFact = StoredMemoryFact & {
  value: string;
  updatedAt: string;
};

export type ChangeReceipt = {
  artifactRef?: string;
  id: string;
  files: string[];
  symbols: string[];
  summary: string;
  validation: "failed" | "passed" | "pending" | "skipped";
  updatedAt: string;
};

export type ValidationSummary = {
  status: "failed" | "passed" | "pending" | "unknown";
  checks: Array<{ id: string; status: string; taskId?: string }>;
  updatedAt: string;
};

export type DialogueTurn = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

type ActiveTurn = {
  requestRef: string;
  startedAt: string;
  completionRef?: string;
  completedAt?: string;
};

type FallbackCheckpoint = DeterministicFallbackMemory & {
  created_at: string;
};

export type ConversationMemory = {
  conversationId: string;
  userGoal: string;
  currentIntent: string;
  currentUserRequestRef: string;
  facts: StoredMemoryFact[];
  evidence: MemoryEvidence[];
  completedChanges: ChangeReceipt[];
  validationState: ValidationSummary;
  recentDialogue: DialogueTurn[];
  fallbackCheckpoints: FallbackCheckpoint[];
  activeTurn?: ActiveTurn;
  nextFocus?: string | null;
  updatedAt: string;
};

export type FileSummary = {
  path: string;
  lastChangeReceiptId?: string;
  symbols: string[];
};

export type ContinuityCapsule = {
  conversationId: string;
  executionEpochId: string;
  userGoal: string;
  relevantConstraints: MemoryFact[];
  relevantDecisions: MemoryFact[];
  recentCompletedChanges: ChangeReceipt[];
  currentValidationState: ValidationSummary;
  activeFiles: FileSummary[];
  unresolvedItems: MemoryFact[];
  recentDialogue: DialogueTurn[];
  nextFocus?: string | null;
};

export type CapsuleBudget = {
  maximum_tokens: number;
  reserved_for_constraints: number;
  reserved_for_decisions: number;
  reserved_for_changes: number;
  reserved_for_dialogue: number;
};

export type TokenCounter = {
  strategy: "provider_tokenizer" | "utf8_upper_bound";
  count(text: string): number;
};

export const utf8TokenUpperBound: TokenCounter = {
  strategy: "utf8_upper_bound",
  count: (text) => Buffer.byteLength(text, "utf8"),
};

export type RecallContextInput = {
  query?: string;
  topic?: string;
  file_path?: string;
  symbol_ref?: string;
  change_receipt_id?: string;
  include_superseded?: boolean;
  maximum_tokens?: number;
};

type ExecutionEpoch = {
  id: string;
  sequence: number;
  reason: string;
  startedAt: string;
};

type StoredConversation = {
  schema_version: "2.0";
  memory: ConversationMemory;
  epoch: ExecutionEpoch;
};

type LegacyStoredConversation = {
  schema_version: "1.0";
  memory: Record<string, unknown>;
  epoch: ExecutionEpoch;
};

type BeginRequestInput = {
  currentRequest: string;
  userGoal: string;
  maximumTokens?: number;
  budget?: Partial<CapsuleBudget>;
  reason?: string;
  requestRef?: string;
};

type RecordChangeInput = {
  artifactRef?: string;
  receiptId: string;
  files: string[];
  symbols: string[];
  summary: string;
  validation: ChangeReceipt["validation"];
};

type CompleteTurnResult = {
  answer: string;
  metrics: ContinuityMergeMetrics;
};

type RecallResult = {
  facts: StoredMemoryFact[];
  changes: ChangeReceipt[];
  dialogue: DialogueTurn[];
  validation: ValidationSummary;
  retrieval_strategy: "exact" | "lexical";
  truncated: boolean;
  candidate_count: number;
  returned_count: number;
};

const defaultCapsuleBudget: CapsuleBudget = {
  maximum_tokens: 2_400,
  reserved_for_constraints: 700,
  reserved_for_decisions: 450,
  reserved_for_changes: 550,
  reserved_for_dialogue: 350,
};

const maximumHistoricalUserMessages = 200;
const maximumTechnicalEvidence = 500;

export class ConversationMemoryStore {
  private readonly conversationId: string;
  private readonly path: string;
  private readonly lockDirectory: string;
  private readonly workingSet: ReadWorkingSet;
  private readonly tokenCounter: TokenCounter;

  constructor(
    workspaceRoot: string,
    conversationId: string,
    tokenCounter: TokenCounter = utf8TokenUpperBound,
  ) {
    this.conversationId = conversationId;
    this.tokenCounter = tokenCounter;
    const root = join(workspaceRoot, ".blame", "harness");
    const identity = sha256(conversationId);
    this.path = join(root, "conversation-memory", `${identity}.json`);
    this.lockDirectory = join(root, "conversation-memory-locks", identity);
    this.workingSet = new ReadWorkingSet(workspaceRoot, conversationId);
  }

  async beginRequest(input: BeginRequestInput) {
    const result = await this.exclusive(async () => {
      const stored = await this.read(input.userGoal);
      const epoch = nextEpoch(stored.epoch, input.reason ?? "change_request");
      const memory = updateForRequest(stored.memory, input, epoch);
      await this.write({ ...stored, memory, epoch });
      const budget = resolveCapsuleBudget(input);
      const capsule = createCapsule(memory, epoch, budget, this.tokenCounter);
      return {
        capsule,
        currentRequest: input.currentRequest,
        inputTokens: countValueTokens(stored.memory, this.tokenCounter),
        outputTokens: renderedCapsuleTokens(capsule, this.tokenCounter),
        requestedTokens: budget.maximum_tokens,
        tokenCountingStrategy: this.tokenCounter.strategy,
        truncated: capsuleWasTruncated(memory, capsule),
      };
    });
    await this.workingSet.activateEpoch(result.capsule.executionEpochId);
    return result;
  }

  async rotate(reason: string, maximumTokens = 2_400) {
    const result = await this.exclusive(async () => {
      const stored = await this.read("");
      const epoch = nextEpoch(stored.epoch, reason);
      const event = runtimeEvidence(
        reason === "model_compaction" ? "compaction" : "epoch_changed",
        `${epoch.id}:${reason}`,
      );
      const memory = appendEvidence(stored.memory, event);
      await this.write({ ...stored, memory, epoch });
      return createCapsule(
        memory,
        epoch,
        {
          ...defaultCapsuleBudget,
          maximum_tokens: maximumTokens,
        },
        this.tokenCounter,
      );
    });
    await this.workingSet.activateEpoch(result.executionEpochId);
    return result;
  }

  async currentEpochId() {
    return (await this.read("")).epoch.id;
  }

  async currentRequest() {
    return (await this.read("")).memory.currentIntent;
  }

  async recordAssistant(content: string, reference?: string) {
    if (!content.trim()) return;
    await this.update((memory) =>
      recordAssistantTurn(memory, content, reference),
    );
  }

  async completeTurn(input: {
    answer: string;
    continuityUpdate?: unknown;
    completionRef: string;
  }): Promise<CompleteTurnResult> {
    return this.exclusive(async () => {
      const stored = await this.read("");
      const existing = existingCompletion(stored.memory, input.answer);
      if (existing) return existing;
      const parsed = parseContinuityUpdate(input.continuityUpdate);
      const completion = parsed.valid
        ? mergeContinuityUpdate(stored.memory, parsed.value)
        : fallbackMerge(
            stored.memory,
            false,
            input.continuityUpdate !== undefined,
          );
      const withAnswer = recordAssistantTurn(
        completion.memory,
        input.answer,
        input.completionRef,
      );
      const memory = completeActiveTurn(withAnswer, input.completionRef);
      await this.write({ ...stored, memory });
      return { answer: input.answer, metrics: completion.metrics };
    });
  }

  async ensureDeterministicFallback(interrupted = false) {
    return this.exclusive(async () => {
      const stored = await this.read("");
      if (!stored.memory.activeTurn || stored.memory.activeTurn.completedAt)
        return false;
      const merged = fallbackMerge(stored.memory, interrupted, false);
      const completionRef = `fallback://${sha256(
        stored.memory.activeTurn.requestRef,
      )}`;
      const memory = completeActiveTurn(merged.memory, completionRef);
      await this.write({ ...stored, memory });
      return true;
    });
  }

  async recordChange(input: RecordChangeInput) {
    return this.exclusive(async () => {
      const stored = await this.read("");
      const receipt = changeReceipt(input);
      const created = !stored.memory.completedChanges.some(
        (change) => change.id === input.receiptId,
      );
      const evidence: MemoryEvidence = {
        type: "change_receipt",
        ref: input.receiptId,
        files: receipt.files,
        symbols: receipt.symbols,
        status: receipt.validation,
        created_at: receipt.updatedAt,
      };
      const memory = appendEvidence(
        {
          ...stored.memory,
          completedChanges: upsertById(
            stored.memory.completedChanges,
            receipt,
          ).slice(-100),
        },
        evidence,
      );
      await this.write({ ...stored, memory });
      return created;
    });
  }

  async recordValidation(input: {
    id: string;
    status: string;
    taskId?: string;
    terminal: "failed" | "passed" | "pending" | "unknown";
  }) {
    await this.update((memory) => {
      const validationState = {
        status: input.terminal,
        checks: upsertById(memory.validationState.checks, {
          id: input.id,
          status: input.status,
          ...(input.taskId ? { taskId: input.taskId } : {}),
        }).slice(-30),
        updatedAt: now(),
      };
      return appendEvidence(
        { ...memory, validationState },
        {
          type: "run_receipt",
          ref: input.id,
          task_id: input.taskId ?? input.id,
          status: input.status,
          created_at: validationState.updatedAt,
        },
      );
    });
  }

  async recordRuntimeEvent(
    event: Extract<MemoryEvidence, { type: "runtime_event" }>["event"],
    reference: string,
    status?: string,
  ) {
    await this.update((memory) =>
      appendEvidence(memory, runtimeEvidence(event, reference, status)),
    );
  }

  async recall(input: RecallContextInput) {
    const { memory } = await this.read("");
    return recallMemory(memory, input, this.tokenCounter);
  }

  async snapshot() {
    return (await this.read("")).memory;
  }

  async completionReadiness() {
    const memory = (await this.read("")).memory;
    const startedAt = memory.activeTurn?.startedAt;
    if (!startedAt) return { completionAllowed: true as const };
    const changes = memory.completedChanges.filter(
      (change) => change.updatedAt >= startedAt,
    );
    const latest = changes
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .at(-1);
    if (!latest || latest.validation === "passed")
      return { completionAllowed: true as const };
    if (
      memory.validationState.status === "passed" &&
      memory.validationState.updatedAt >= latest.updatedAt
    )
      return { completionAllowed: true as const };
    return {
      completionAllowed: false as const,
      reason: "NO_POST_EDIT_VALIDATION" as const,
    };
  }

  private async update(
    transform: (memory: ConversationMemory) => ConversationMemory,
  ) {
    await this.exclusive(async () => {
      const stored = await this.read("");
      const memory = { ...transform(stored.memory), updatedAt: now() };
      await this.write({ ...stored, memory });
    });
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 10, maxTimeout: 500 },
      stale: 30_000,
      update: 5_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async read(userGoal: string): Promise<StoredConversation> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as
        | StoredConversation
        | LegacyStoredConversation;
      if (stored.schema_version === "2.0") return stored;
      if (stored.schema_version === "1.0") return migrateConversation(stored);
      throw new Error("Unsupported memory schema.");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      return initialConversation(this.conversationId, userGoal);
    }
  }

  private async write(value: StoredConversation) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(value), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function existingCompletion(
  memory: ConversationMemory,
  fallbackAnswer: string,
): CompleteTurnResult | undefined {
  const reference = memory.activeTurn?.completionRef;
  if (!reference) return undefined;
  return {
    answer:
      memory.recentDialogue.find((turn) => turn.id === reference)?.content ??
      fallbackAnswer,
    metrics: duplicateCompletionMetrics(),
  };
}

export function renderContinuityCapsule(capsule: ContinuityCapsule) {
  return `<continuity_capsule>\n${JSON.stringify(capsule)}\n</continuity_capsule>`;
}

export function renderCurrentUserRequest(currentRequest: string) {
  return `<current_user_request>\n${currentRequest}\n</current_user_request>`;
}

export function renderContinuityPrompt(
  capsule: ContinuityCapsule,
  currentRequest: string,
) {
  return `${renderContinuityCapsule(capsule)}\n\n${renderCurrentUserRequest(
    currentRequest,
  )}`;
}

export function renderedCapsuleTokens(
  capsule: ContinuityCapsule,
  tokenCounter: TokenCounter = utf8TokenUpperBound,
) {
  return tokenCounter.count(renderContinuityCapsule(capsule));
}

function initialConversation(
  conversationId: string,
  userGoal: string,
): StoredConversation {
  const timestamp = now();
  return {
    schema_version: "2.0",
    memory: {
      conversationId,
      userGoal,
      currentIntent: "",
      currentUserRequestRef: "",
      facts: [],
      evidence: [],
      completedChanges: [],
      validationState: { status: "unknown", checks: [], updatedAt: timestamp },
      recentDialogue: [],
      fallbackCheckpoints: [],
      updatedAt: timestamp,
    },
    epoch: {
      id: epochId(conversationId, 0),
      sequence: 0,
      reason: "created",
      startedAt: timestamp,
    },
  };
}

function updateForRequest(
  memory: ConversationMemory,
  input: BeginRequestInput,
  epoch: ExecutionEpoch,
) {
  const createdAt = now();
  const requestRef = requestReference(memory, input, epoch);
  const withEvidence = appendEvidence(
    memory,
    userMessageEvidence(input.currentRequest, requestRef, createdAt),
  );
  const withFacts = mergeUserFacts(
    withEvidence,
    extractUserFacts(input.currentRequest, requestRef),
  );
  return appendEvidence(
    requestState(withFacts, memory, input, requestRef, createdAt),
    runtimeEvidence("epoch_changed", epoch.id, epoch.reason),
  );
}

function requestState(
  memory: ConversationMemory,
  previous: ConversationMemory,
  input: BeginRequestInput,
  requestRef: string,
  createdAt: string,
) {
  return {
    ...memory,
    userGoal: previous.userGoal || input.userGoal,
    currentIntent: input.currentRequest,
    currentUserRequestRef: requestRef,
    recentDialogue: appendDialogue(
      previous.recentDialogue,
      "user",
      input.currentRequest,
      requestRef,
    ),
    activeTurn: { requestRef, startedAt: createdAt },
    updatedAt: createdAt,
  };
}

function requestReference(
  memory: ConversationMemory,
  input: BeginRequestInput,
  epoch: ExecutionEpoch,
) {
  if (input.requestRef) return input.requestRef;
  const identity = `${memory.conversationId}\0${epoch.sequence}\0${input.currentRequest}`;
  return `user-message://${sha256(identity)}`;
}

function userMessageEvidence(
  content: string,
  ref: string,
  createdAt: string,
): MemoryEvidence {
  return { type: "user_message", ref, content, created_at: createdAt };
}

function recordAssistantTurn(
  memory: ConversationMemory,
  content: string,
  reference?: string,
) {
  const last = memory.recentDialogue.at(-1);
  if (last?.role === "assistant" && last.content === content) return memory;
  const createdAt = now();
  const ref = reference ?? assistantTurnReference(memory, content);
  return appendEvidence(
    {
      ...memory,
      recentDialogue: appendDialogue(
        memory.recentDialogue,
        "assistant",
        content,
        ref,
      ),
    },
    assistantTurnEvidence(content, ref, createdAt),
  );
}

function assistantTurnReference(memory: ConversationMemory, content: string) {
  const identity = `${memory.conversationId}\0${memory.currentUserRequestRef}\0${content}`;
  return `assistant-turn://${sha256(identity)}`;
}

function assistantTurnEvidence(
  content: string,
  ref: string,
  createdAt: string,
): MemoryEvidence {
  return {
    type: "assistant_turn",
    ref,
    answer_summary: compactText(content, 1_000),
    created_at: createdAt,
  };
}

function completeActiveTurn(memory: ConversationMemory, completionRef: string) {
  if (!memory.activeTurn) return memory;
  const completedAt = now();
  return {
    ...memory,
    activeTurn: { ...memory.activeTurn, completionRef, completedAt },
    updatedAt: completedAt,
  };
}

function mergeContinuityUpdate(
  memory: ConversationMemory,
  update: ContinuityUpdate,
) {
  const state = createMergeState(memory);
  applyIntent(state, update);
  applyAddedFacts(state, update);
  applySupersededFacts(state, update);
  applyResolvedItems(state, update);
  state.memory.nextFocus = update.next_focus;
  return { memory: state.memory, metrics: state.metrics };
}

function createMergeState(memory: ConversationMemory) {
  return {
    memory: { ...memory, facts: [...memory.facts] },
    validRefs: validEvidenceReferences(memory),
    validChangeRefs: validChangeReceiptReferences(memory),
    metrics: {
      continuity_update_present: true,
      continuity_update_valid: true,
      continuity_fallback_used: false,
      facts_added_count: 0,
      facts_superseded_count: 0,
      invalid_evidence_ref_count: 0,
      memory_merge_conflict_count: 0,
    } satisfies ContinuityMergeMetrics,
  };
}

function applyIntent(
  state: ReturnType<typeof createMergeState>,
  update: ContinuityUpdate,
) {
  if (update.intent?.summary)
    state.memory.currentIntent = update.intent.summary;
  for (const reference of update.change_receipt_refs) {
    if (!state.validChangeRefs.has(reference))
      state.metrics.invalid_evidence_ref_count += 1;
  }
}

function applyAddedFacts(
  state: ReturnType<typeof createMergeState>,
  update: ContinuityUpdate,
) {
  for (const proposed of update.facts_added) {
    const evidence = filterEvidenceRefs(proposed.evidence_refs, state);
    if (!technicalFactAllowed(proposed.text, evidence, state.memory)) {
      state.metrics.memory_merge_conflict_count += 1;
      continue;
    }
    const result = mergeAgentFact(state.memory.facts, proposed, evidence);
    state.memory.facts = result.facts;
    state.metrics.facts_added_count += Number(result.created);
  }
}

function applySupersededFacts(
  state: ReturnType<typeof createMergeState>,
  update: ContinuityUpdate,
) {
  for (const proposed of update.facts_superseded) {
    filterEvidenceRefs(proposed.evidence_refs, state);
    const index = state.memory.facts.findIndex(
      (fact) => fact.id === proposed.fact_id,
    );
    if (index < 0 || state.memory.facts[index]?.authority === "user") {
      state.metrics.memory_merge_conflict_count += 1;
      continue;
    }
    const current = state.memory.facts[index];
    if (!current || current.status !== "active") continue;
    state.memory.facts[index] = {
      ...current,
      status: "superseded",
      updated_at: now(),
    };
    state.metrics.facts_superseded_count += 1;
  }
}

function applyResolvedItems(
  state: ReturnType<typeof createMergeState>,
  update: ContinuityUpdate,
) {
  const runtimeRefs = new Set(update.change_receipt_refs);
  for (const id of update.items_resolved) {
    const index = state.memory.facts.findIndex((fact) => fact.id === id);
    const fact = state.memory.facts[index];
    if (!fact || fact.kind !== "open_item" || fact.status !== "active")
      continue;
    if (
      fact.authority === "user" &&
      !hasValidRuntimeRef(runtimeRefs, state.memory)
    ) {
      state.metrics.memory_merge_conflict_count += 1;
      continue;
    }
    state.memory.facts[index] = {
      ...fact,
      status: "resolved",
      updated_at: now(),
    };
  }
}

function filterEvidenceRefs(
  references: string[] | undefined,
  state: ReturnType<typeof createMergeState>,
) {
  const filtered = (references ?? []).filter((reference) => {
    const valid = state.validRefs.has(reference);
    if (!valid) state.metrics.invalid_evidence_ref_count += 1;
    return valid;
  });
  return unique(filtered);
}

function mergeAgentFact(
  facts: StoredMemoryFact[],
  proposed: ProposedMemoryFact,
  evidenceRefs: string[],
) {
  const normalized = normalizeMemoryFactText(proposed.text);
  const existing = facts.find(
    (fact) =>
      fact.kind === proposed.kind &&
      fact.normalized_text === normalized &&
      sameScope(fact.scope, proposed.scope),
  );
  if (existing) {
    const updated = {
      ...existing,
      evidence_refs: unique([...existing.evidence_refs, ...evidenceRefs]),
      updated_at: now(),
    };
    return { facts: upsertById(facts, updated), created: false };
  }
  const fact = storedFact(proposed, "agent", evidenceRefs);
  return { facts: [...facts, fact].slice(-300), created: true };
}

function fallbackMerge(
  memory: ConversationMemory,
  interrupted: boolean,
  updatePresent: boolean,
) {
  const checkpoint = deterministicFallback(memory, interrupted);
  const withCheckpoint = appendFallbackCheckpoint(memory, checkpoint);
  return {
    memory: interrupted
      ? appendEvidence(
          withCheckpoint,
          runtimeEvidence("interruption", checkpoint.current_user_request_ref),
        )
      : withCheckpoint,
    metrics: continuityFallbackMetrics(updatePresent),
  };
}

function appendFallbackCheckpoint(
  memory: ConversationMemory,
  checkpoint: FallbackCheckpoint,
) {
  const exists = memory.fallbackCheckpoints.some(
    (item) =>
      item.current_user_request_ref === checkpoint.current_user_request_ref,
  );
  if (exists) return memory;
  return {
    ...memory,
    fallbackCheckpoints: [...memory.fallbackCheckpoints, checkpoint].slice(-50),
  };
}

function deterministicFallback(
  memory: ConversationMemory,
  interrupted: boolean,
): FallbackCheckpoint {
  const startedAt = memory.activeTurn?.startedAt ?? memory.updatedAt;
  const recentEvidence = memory.evidence.filter(
    (item) => item.created_at >= startedAt,
  );
  return {
    current_user_request_ref: memory.currentUserRequestRef,
    applied_change_refs: recentEvidence
      .filter((item) => item.type === "change_receipt")
      .map((item) => item.ref),
    run_refs: recentEvidence
      .filter((item) => item.type === "run_receipt")
      .map((item) => item.ref),
    validation_status: memory.validationState.status,
    interrupted,
    created_at: now(),
  };
}

function duplicateCompletionMetrics(): ContinuityMergeMetrics {
  return {
    continuity_update_present: true,
    continuity_update_valid: true,
    continuity_fallback_used: false,
    facts_added_count: 0,
    facts_superseded_count: 0,
    invalid_evidence_ref_count: 0,
    memory_merge_conflict_count: 0,
  };
}

function extractUserFacts(content: string, evidenceRef: string) {
  return content
    .split(/\r?\n|(?<=[.!?])\s+/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .flatMap((line) => userFactFromLine(line, evidenceRef));
}

function userFactFromLine(line: string, evidenceRef: string) {
  const proposal = classifyUserFact(line);
  if (!proposal) return [];
  return [
    {
      fact: storedFact(proposal, "user", [evidenceRef]),
      replaces: replacementExpression.test(line),
    },
  ];
}

const replacementExpression =
  /\b(?:finalement|finally|désormais|plutôt|reviens|remets|instead|actually|revert|restore)\b/iu;

function classifyUserFact(line: string): ProposedMemoryFact | undefined {
  const scope = inferScope(line);
  if (/\?|\b(?:reste|à\s+faire|todo|unresolved|follow[- ]?up)\b/iu.test(line))
    return memoryProposal("open_item", line, scope, "story");
  if (/\b(?:préfère|préférence|prefer|preference)\b/iu.test(line))
    return memoryProposal("preference", line, scope, "conversation");
  if (/\b(?:refus[ée]?|annul[ée]?|rejette|reject|cancel)\b/iu.test(line))
    return memoryProposal("rejection", line, scope, "story");
  if (replacementExpression.test(line))
    return memoryProposal("decision", line, scope, "story");
  if (
    /\b(?:doit|doivent|garde|conserve|sans|ne\s+pas|jamais|uniquement|must|keep|without|never|only)\b/iu.test(
      line,
    )
  )
    return memoryProposal("constraint", line, scope, "conversation");
  if (
    /\b(?:décision|valid[ée]|on\s+garde|retenu|accept[ée]|decision|approved)\b/iu.test(
      line,
    )
  )
    return memoryProposal("decision", line, scope, "story");
  return undefined;
}

function memoryProposal(
  kind: ProposedMemoryFact["kind"],
  text: string,
  scope: MemoryScope,
  durability: ProposedMemoryFact["durability"],
): ProposedMemoryFact {
  return { kind, text: compactText(text, 1_000), scope, durability };
}

function inferScope(text: string): MemoryScope {
  const file = text.match(/(?:^|\s)([\w./-]+\.[a-z0-9]{1,8})(?:\s|$)/iu)?.[1];
  if (file) return { type: "file", value: file };
  if (/\b(?:mobile|desktop|tablet|viewport|responsive)\b/iu.test(text))
    return { type: "viewport", value: viewportValue(text) };
  const platform = text.match(/\b(?:linux|macos|windows|wsl|lima)\b/iu)?.[0];
  if (platform) return { type: "platform", value: normalize(platform) };
  return { type: "global" };
}

function viewportValue(text: string) {
  return normalize(
    text.match(/\b(?:mobile|desktop|tablet)\b/iu)?.[0] ?? "responsive",
  );
}

function storedFact(
  proposed: ProposedMemoryFact,
  authority: StoredMemoryFact["authority"],
  evidenceRefs: string[],
): StoredMemoryFact {
  const normalized = normalizeMemoryFactText(proposed.text);
  const timestamp = now();
  return {
    id: `memory://${sha256(
      `${proposed.kind}\0${scopeKey(proposed.scope)}\0${normalized}`,
    )}`,
    kind: proposed.kind,
    text: proposed.text,
    normalized_text: normalized,
    scope: proposed.scope,
    durability: proposed.durability,
    status: proposed.kind === "rejection" ? "rejected" : "active",
    authority,
    evidence_refs: unique(evidenceRefs),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function mergeUserFacts(
  memory: ConversationMemory,
  incoming: Array<{ fact: StoredMemoryFact; replaces: boolean }>,
) {
  let facts = [...memory.facts];
  for (const item of incoming) {
    if (item.replaces) facts = supersedeRelatedFacts(facts, item.fact);
    facts = mergeAuthoritativeFact(facts, item.fact);
  }
  return { ...memory, facts: facts.slice(-300) };
}

function supersedeRelatedFacts(
  facts: StoredMemoryFact[],
  replacement: StoredMemoryFact,
) {
  return facts.map((fact) => {
    const replaceable =
      fact.status === "active" &&
      fact.authority === "user" &&
      sameScope(fact.scope, replacement.scope) &&
      relatedFactScore(fact, replacement) > 0;
    return replaceable
      ? {
          ...fact,
          status: "superseded" as const,
          superseded_by: replacement.id,
          updated_at: replacement.created_at,
        }
      : fact;
  });
}

function mergeAuthoritativeFact(
  facts: StoredMemoryFact[],
  incoming: StoredMemoryFact,
) {
  const existing = facts.find((fact) => fact.id === incoming.id);
  if (!existing) return [...facts, incoming];
  return upsertById(facts, {
    ...existing,
    authority:
      authorityRank(incoming.authority) >= authorityRank(existing.authority)
        ? incoming.authority
        : existing.authority,
    evidence_refs: unique([
      ...existing.evidence_refs,
      ...incoming.evidence_refs,
    ]),
    status: incoming.status,
    updated_at: incoming.updated_at,
  });
}

function createCapsule(
  memory: ConversationMemory,
  epoch: ExecutionEpoch,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
): ContinuityCapsule {
  const terms = expandedTerms(memory.currentIntent);
  const capsule = emptyCapsule(memory, epoch, budget, tokenCounter);
  appendCapsuleFacts(capsule, memory, terms, budget, tokenCounter);
  appendCapsuleChanges(capsule, memory, terms, budget, tokenCounter);
  appendCapsuleDialogue(capsule, memory, budget, tokenCounter);
  return capsule;
}

function appendCapsuleFacts(
  capsule: ContinuityCapsule,
  memory: ConversationMemory,
  terms: Set<string>,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
) {
  appendCapsuleItems(
    capsule,
    "relevantConstraints",
    rankedFacts(activeFacts(memory, ["constraint", "preference"]), terms),
    budget.reserved_for_constraints,
    budget.maximum_tokens,
    tokenCounter,
  );
  appendCapsuleItems(
    capsule,
    "relevantDecisions",
    rankedFacts(activeFacts(memory, ["decision", "rejection"]), terms),
    budget.reserved_for_decisions,
    budget.maximum_tokens,
    tokenCounter,
  );
}

function appendCapsuleChanges(
  capsule: ContinuityCapsule,
  memory: ConversationMemory,
  terms: Set<string>,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
) {
  appendCapsuleItems(
    capsule,
    "unresolvedItems",
    rankedFacts(activeFacts(memory, ["open_item"]), terms),
    budget.reserved_for_constraints,
    budget.maximum_tokens,
    tokenCounter,
  );
  appendCapsuleItems(
    capsule,
    "recentCompletedChanges",
    rankedChanges(memory.completedChanges, terms),
    budget.reserved_for_changes,
    budget.maximum_tokens,
    tokenCounter,
  );
  appendCapsuleValidationAndFiles(capsule, memory, budget, tokenCounter);
}

function appendCapsuleValidationAndFiles(
  capsule: ContinuityCapsule,
  memory: ConversationMemory,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
) {
  appendValidation(
    capsule,
    memory.validationState,
    budget.maximum_tokens,
    tokenCounter,
  );
  appendActiveFiles(
    capsule,
    activeFiles(memory.completedChanges),
    budget.maximum_tokens,
    tokenCounter,
  );
}

function appendCapsuleDialogue(
  capsule: ContinuityCapsule,
  memory: ConversationMemory,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
) {
  appendCapsuleItems(
    capsule,
    "recentDialogue",
    memory.recentDialogue
      .filter((turn) => turn.id !== memory.currentUserRequestRef)
      .reverse(),
    budget.reserved_for_dialogue,
    budget.maximum_tokens,
    tokenCounter,
  );
}

function emptyCapsule(
  memory: ConversationMemory,
  epoch: ExecutionEpoch,
  budget: CapsuleBudget,
  tokenCounter: TokenCounter,
): ContinuityCapsule {
  const maximumTokens = budget.maximum_tokens;
  const capsule: ContinuityCapsule = {
    conversationId: memory.conversationId,
    executionEpochId: epoch.id,
    userGoal: compactText(
      priorUserGoal(memory),
      Math.min(1_000, maximumTokens),
    ),
    relevantConstraints: [],
    relevantDecisions: [],
    recentCompletedChanges: [],
    currentValidationState: emptyValidation(memory.validationState.updatedAt),
    activeFiles: [],
    unresolvedItems: [],
    recentDialogue: [],
    ...(memory.nextFocus ? { nextFocus: memory.nextFocus } : {}),
  };
  shrinkCapsuleBase(capsule, maximumTokens, tokenCounter);
  return capsule;
}

type CapsuleArrayKey =
  | "relevantConstraints"
  | "relevantDecisions"
  | "recentCompletedChanges"
  | "unresolvedItems"
  | "recentDialogue";

function appendCapsuleItems(
  capsule: ContinuityCapsule,
  key: CapsuleArrayKey,
  items: Array<MemoryFact | ChangeReceipt | DialogueTurn>,
  sectionTokens: number,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  const initialTokens = renderedCapsuleTokens(capsule, tokenCounter);
  for (const item of items) {
    const previous = [...capsule[key]] as never[];
    (capsule[key] as never[]).push(item as never);
    const sectionSize =
      renderedCapsuleTokens(capsule, tokenCounter) - initialTokens;
    if (
      sectionSize <= sectionTokens &&
      renderedCapsuleTokens(capsule, tokenCounter) <= maximumTokens
    )
      continue;
    capsule[key] = previous as never;
    break;
  }
}

function appendValidation(
  capsule: ContinuityCapsule,
  validation: ValidationSummary,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  const previous = capsule.currentValidationState;
  capsule.currentValidationState = validation;
  if (renderedCapsuleTokens(capsule, tokenCounter) > maximumTokens)
    capsule.currentValidationState = previous;
}

function appendActiveFiles(
  capsule: ContinuityCapsule,
  files: FileSummary[],
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  for (const file of files) {
    capsule.activeFiles.push(file);
    if (renderedCapsuleTokens(capsule, tokenCounter) <= maximumTokens) continue;
    capsule.activeFiles.pop();
    break;
  }
}

function shrinkCapsuleBase(
  capsule: ContinuityCapsule,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  if (renderedCapsuleTokens(capsule, tokenCounter) <= maximumTokens) return;
  delete capsule.nextFocus;
  if (renderedCapsuleTokens(capsule, tokenCounter) <= maximumTokens) return;
  capsule.userGoal = fitStringToCapsule(capsule, maximumTokens, tokenCounter);
}

function fitStringToCapsule(
  capsule: ContinuityCapsule,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  const source = capsule.userGoal;
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    capsule.userGoal = compactText(source, middle);
    if (renderedCapsuleTokens(capsule, tokenCounter) <= maximumTokens)
      low = middle;
    else high = middle - 1;
  }
  return low ? compactText(source, low) : "";
}

function resolveCapsuleBudget(input: BeginRequestInput): CapsuleBudget {
  const maximum = Math.max(
    100,
    Math.floor(input.budget?.maximum_tokens ?? input.maximumTokens ?? 2_400),
  );
  return {
    maximum_tokens: maximum,
    reserved_for_constraints: boundedReservation(
      input.budget?.reserved_for_constraints,
      defaultCapsuleBudget.reserved_for_constraints,
      maximum,
    ),
    reserved_for_decisions: boundedReservation(
      input.budget?.reserved_for_decisions,
      defaultCapsuleBudget.reserved_for_decisions,
      maximum,
    ),
    reserved_for_changes: boundedReservation(
      input.budget?.reserved_for_changes,
      defaultCapsuleBudget.reserved_for_changes,
      maximum,
    ),
    reserved_for_dialogue: boundedReservation(
      input.budget?.reserved_for_dialogue,
      defaultCapsuleBudget.reserved_for_dialogue,
      maximum,
    ),
  };
}

function boundedReservation(
  requested: number | undefined,
  fallback: number,
  maximum: number,
) {
  return Math.max(0, Math.min(maximum, Math.floor(requested ?? fallback)));
}

function capsuleWasTruncated(
  memory: ConversationMemory,
  capsule: ContinuityCapsule,
) {
  return (
    capsule.relevantConstraints.length <
      activeFacts(memory, ["constraint", "preference"]).length ||
    capsule.relevantDecisions.length <
      activeFacts(memory, ["decision", "rejection"]).length ||
    capsule.unresolvedItems.length <
      activeFacts(memory, ["open_item"]).length ||
    capsule.recentCompletedChanges.length < memory.completedChanges.length ||
    capsule.recentDialogue.length <
      memory.recentDialogue.filter(
        (turn) => turn.id !== memory.currentUserRequestRef,
      ).length
  );
}

function recallMemory(
  memory: ConversationMemory,
  input: RecallContextInput,
  tokenCounter: TokenCounter,
) {
  const terms = expandedTerms(recallQuery(input));
  const includeHistory =
    input.include_superseded === true || historicalQuery(recallQuery(input));
  const candidates = memory.facts.filter(
    (fact) =>
      includeHistory || fact.status === "active" || fact.status === "rejected",
  );
  const facts = recallFacts(candidates, input, terms);
  const changes = recallChanges(memory.completedChanges, input, terms);
  const dialogue = recallDialogue(memory, terms);
  return fitRecallResult(
    memory,
    input,
    facts,
    changes,
    dialogue,
    facts.length + changes.length + dialogue.length,
    tokenCounter,
  );
}

function recallDialogue(memory: ConversationMemory, terms: Set<string>) {
  const byId = new Map<string, DialogueTurn>(
    historicalUserDialogue(memory).map((turn) => [turn.id, turn]),
  );
  for (const turn of memory.recentDialogue) byId.set(turn.id, turn);
  return [...byId.values()]
    .filter((turn) => turn.id !== memory.currentUserRequestRef)
    .filter((turn) => textMatches(turn.content, terms))
    .sort(
      (left, right) => dialogueScore(right, terms) - dialogueScore(left, terms),
    );
}

function historicalUserDialogue(memory: ConversationMemory) {
  return memory.evidence
    .filter(
      (
        evidence,
      ): evidence is Extract<MemoryEvidence, { type: "user_message" }> =>
        evidence.type === "user_message",
    )
    .slice(-maximumHistoricalUserMessages)
    .map((evidence) => ({
      id: evidence.ref,
      role: "user" as const,
      content: evidence.content,
      createdAt: evidence.created_at,
    }));
}

function dialogueScore(dialogue: DialogueTurn, terms: Set<string>) {
  return (
    lexicalScore(dialogue.content, terms) * 10 +
    recencyScore(dialogue.createdAt)
  );
}

function recallFacts(
  candidates: StoredMemoryFact[],
  input: RecallContextInput,
  terms: Set<string>,
) {
  return candidates
    .filter((fact) => factMatches(fact, input, terms))
    .sort(
      (left, right) =>
        factScore(right, input, terms) - factScore(left, input, terms),
    );
}

function recallChanges(
  changes: ChangeReceipt[],
  input: RecallContextInput,
  terms: Set<string>,
) {
  return changes
    .filter((change) => changeMatches(change, input, terms))
    .sort(
      (left, right) =>
        changeScore(right, input, terms) - changeScore(left, input, terms),
    );
}

function fitRecallResult(
  memory: ConversationMemory,
  input: RecallContextInput,
  facts: StoredMemoryFact[],
  changes: ChangeReceipt[],
  dialogue: DialogueTurn[],
  candidateCount: number,
  tokenCounter: TokenCounter,
) {
  const maximumTokens = Math.max(100, input.maximum_tokens ?? 1_200);
  const result = emptyRecallResult(memory, input, candidateCount);
  appendRecallValidation(
    result,
    memory.validationState,
    maximumTokens,
    tokenCounter,
  );
  appendRecallItems(result, "facts", facts, maximumTokens, tokenCounter);
  appendRecallItems(result, "changes", changes, maximumTokens, tokenCounter);
  appendRecallItems(result, "dialogue", dialogue, maximumTokens, tokenCounter);
  return finalizeRecallResult(result, facts, changes, dialogue);
}

function emptyRecallResult(
  memory: ConversationMemory,
  input: RecallContextInput,
  candidateCount: number,
): RecallResult {
  return {
    facts: [],
    changes: [],
    dialogue: [],
    validation: emptyValidation(memory.validationState.updatedAt),
    retrieval_strategy: input.change_receipt_id ? "exact" : "lexical",
    truncated: false,
    candidate_count: candidateCount,
    returned_count: 0,
  };
}

function finalizeRecallResult(
  result: RecallResult,
  facts: StoredMemoryFact[],
  changes: ChangeReceipt[],
  dialogue: DialogueTurn[],
) {
  result.returned_count =
    result.facts.length + result.changes.length + result.dialogue.length;
  result.truncated =
    result.returned_count < facts.length + changes.length + dialogue.length;
  return result;
}

function appendRecallValidation(
  result: RecallResult,
  validation: ValidationSummary,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  result.validation.status = validation.status;
  for (const check of validation.checks) {
    result.validation.checks.push(check);
    if (countValueTokens(result, tokenCounter) <= maximumTokens) continue;
    result.validation.checks.pop();
    break;
  }
}

function appendRecallItems(
  result: RecallResult,
  key: "facts" | "changes" | "dialogue",
  items: Array<StoredMemoryFact | ChangeReceipt | DialogueTurn>,
  maximumTokens: number,
  tokenCounter: TokenCounter,
) {
  for (const item of items) {
    (result[key] as unknown[]).push(item);
    if (countValueTokens(result, tokenCounter) <= maximumTokens) continue;
    (result[key] as unknown[]).pop();
    break;
  }
}

function factMatches(
  fact: StoredMemoryFact,
  input: RecallContextInput,
  terms: Set<string>,
) {
  if (input.file_path && scopeContains(fact.scope, input.file_path))
    return true;
  if (input.symbol_ref && scopeContains(fact.scope, input.symbol_ref))
    return true;
  return textMatches(fact.text, terms);
}

function factScore(
  fact: StoredMemoryFact,
  input: RecallContextInput,
  terms: Set<string>,
) {
  return (
    lexicalScore(fact.text, terms) * 10 +
    Number(input.file_path && scopeContains(fact.scope, input.file_path)) * 20 +
    Number(input.symbol_ref && scopeContains(fact.scope, input.symbol_ref)) *
      25 +
    authorityRank(fact.authority) * 4 +
    Number(fact.status === "active") * 8 +
    recencyScore(fact.updated_at)
  );
}

function changeMatches(
  change: ChangeReceipt,
  input: RecallContextInput,
  terms: Set<string>,
) {
  if (input.change_receipt_id) return change.id === input.change_receipt_id;
  if (input.file_path && change.files.includes(input.file_path)) return true;
  if (input.symbol_ref && change.symbols.includes(input.symbol_ref))
    return true;
  return textMatches(changeText(change), terms);
}

function changeScore(
  change: ChangeReceipt,
  input: RecallContextInput,
  terms: Set<string>,
) {
  return (
    Number(change.id === input.change_receipt_id) * 100 +
    Number(Boolean(input.file_path && change.files.includes(input.file_path))) *
      30 +
    Number(
      Boolean(input.symbol_ref && change.symbols.includes(input.symbol_ref)),
    ) *
      35 +
    lexicalScore(changeText(change), terms) * 10 +
    recencyScore(change.updatedAt)
  );
}

function rankedFacts(facts: StoredMemoryFact[], terms: Set<string>) {
  return [...facts]
    .sort(
      (left, right) => factScore(right, {}, terms) - factScore(left, {}, terms),
    )
    .map(capsuleFact);
}

function rankedChanges(changes: ChangeReceipt[], terms: Set<string>) {
  return [...changes].sort(
    (left, right) =>
      changeScore(right, {}, terms) - changeScore(left, {}, terms),
  );
}

function capsuleFact(fact: StoredMemoryFact): MemoryFact {
  return { ...fact, value: fact.text, updatedAt: fact.updated_at };
}

function activeFacts(
  memory: ConversationMemory,
  kinds: StoredMemoryFact["kind"][],
) {
  return memory.facts.filter(
    (fact) =>
      kinds.includes(fact.kind) &&
      !fact.evidence_refs.includes(memory.currentUserRequestRef) &&
      (fact.status === "active" ||
        (fact.kind === "rejection" && fact.status === "rejected")),
  );
}

function priorUserGoal(memory: ConversationMemory) {
  if (!memory.currentIntent) return memory.userGoal;
  return memory.userGoal.split(memory.currentIntent).join("").trim();
}

function activeFiles(changes: ChangeReceipt[]) {
  const byPath = new Map<string, FileSummary>();
  for (const change of changes.slice(-20)) {
    for (const path of change.files) {
      const current = byPath.get(path);
      byPath.set(path, {
        path,
        lastChangeReceiptId: change.id,
        symbols: unique([...(current?.symbols ?? []), ...change.symbols]).slice(
          -20,
        ),
      });
    }
  }
  return [...byPath.values()].slice(-30);
}

function changeReceipt(input: RecordChangeInput): ChangeReceipt {
  return {
    id: input.receiptId,
    ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    files: unique(input.files),
    symbols: unique(input.symbols),
    summary: compactText(input.summary, 1_000),
    validation: input.validation,
    updatedAt: now(),
  };
}

function appendEvidence(memory: ConversationMemory, evidence: MemoryEvidence) {
  return {
    ...memory,
    evidence: retainEvidence(upsertByReference(memory.evidence, evidence)),
    updatedAt: now(),
  };
}

function retainEvidence(evidence: MemoryEvidence[]) {
  const retainedTechnicalReferences = new Set(
    evidence
      .filter((item) => item.type !== "user_message")
      .slice(-maximumTechnicalEvidence)
      .map((item) => item.ref),
  );
  return evidence.filter(
    (item) =>
      item.type === "user_message" || retainedTechnicalReferences.has(item.ref),
  );
}

function runtimeEvidence(
  event: Extract<MemoryEvidence, { type: "runtime_event" }>["event"],
  reference: string,
  status?: string,
): MemoryEvidence {
  return {
    type: "runtime_event",
    ref:
      event === "validation"
        ? reference
        : `runtime-event://${sha256(`${event}\0${reference}`)}`,
    event,
    ...(status ? { status } : {}),
    created_at: now(),
  };
}

function appendDialogue(
  dialogue: DialogueTurn[],
  role: DialogueTurn["role"],
  content: string,
  reference: string,
) {
  const next = upsertById(dialogue, {
    id: reference,
    role,
    content,
    createdAt: now(),
  });
  const kept = new Set(
    (["user", "assistant"] as const).flatMap((candidateRole) =>
      next
        .filter((turn) => turn.role === candidateRole)
        .slice(-6)
        .map((turn) => turn.id),
    ),
  );
  return next.filter((turn) => kept.has(turn.id));
}

function validEvidenceReferences(memory: ConversationMemory) {
  return new Set(
    memory.evidence.flatMap((evidence) => {
      if (evidence.type !== "change_receipt") return [evidence.ref];
      const receipt = memory.completedChanges.find(
        (change) => change.id === evidence.ref,
      );
      return [evidence.ref, receipt?.artifactRef].filter(Boolean) as string[];
    }),
  );
}

function validChangeReceiptReferences(memory: ConversationMemory) {
  return new Set(
    memory.completedChanges.flatMap(
      (change) => [change.id, change.artifactRef].filter(Boolean) as string[],
    ),
  );
}

function technicalFactAllowed(
  text: string,
  evidenceRefs: string[],
  memory: ConversationMemory,
) {
  const needsRun =
    /\b(?:tests?|lint|build|typecheck)\b.*\b(?:pass|passed|réussi|succès|success)\b/iu.test(
      text,
    );
  const needsChange =
    /\b(?:file|fichier|code)\b.*\b(?:modified|modifié|changed|applied|appliqué)\b/iu.test(
      text,
    );
  if (needsRun)
    return evidenceRefs.some((ref) =>
      memory.evidence.some(
        (item) =>
          item.type === "run_receipt" &&
          item.ref === ref &&
          item.status === "passed",
      ),
    );
  if (needsChange)
    return evidenceRefs.some((ref) =>
      memory.evidence.some(
        (item) => item.type === "change_receipt" && item.ref === ref,
      ),
    );
  return true;
}

function hasValidRuntimeRef(
  references: Set<string>,
  memory: ConversationMemory,
) {
  return memory.evidence.some(
    (item) =>
      references.has(item.ref) &&
      (item.type === "change_receipt" || item.type === "run_receipt"),
  );
}

function recallQuery(input: RecallContextInput) {
  return [input.query, input.topic, input.file_path, input.symbol_ref]
    .filter(Boolean)
    .join(" ");
}

const synonymGroups = [
  ["title", "titre", "heading"],
  ["color", "colour", "couleur"],
  ["mobile", "responsive", "viewport"],
  ["previous", "precedent", "avant", "before"],
  ["restore", "revert", "reviens", "remets", "retour"],
  ["keep", "garde", "conserve"],
  ["never", "jamais"],
  ["use", "utilise", "utiliser"],
];

function normalizeMemoryFactText(value: string) {
  let normalized = normalize(value);
  for (const [canonical, ...synonyms] of synonymGroups) {
    for (const synonym of synonyms)
      normalized = normalized.replace(
        new RegExp(`\\b${escapeRegularExpression(synonym)}\\b`, "gu"),
        canonical ?? synonym,
      );
  }
  return normalized
    .replace(/[.,!?;]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function expandedTerms(value: string) {
  const terms = normalizedTerms(value);
  for (const group of synonymGroups) {
    if (!group.some((term) => terms.has(term))) continue;
    group.forEach((term) => terms.add(term));
  }
  return terms;
}

function normalizedTerms(value: string) {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9_./:-]+/u)
      .filter((term) => term.length > 2 && !stopWords.has(term)),
  );
}

const stopWords = new Set([
  "avec",
  "dans",
  "des",
  "les",
  "pour",
  "the",
  "this",
  "that",
  "une",
  "sur",
]);

function historicalQuery(value: string) {
  return /\b(?:avant|ancien|ancienne|previous|before|reviens|remets|restore|revert)\b/iu.test(
    value,
  );
}

function textMatches(value: string, terms: Set<string>) {
  if (!terms.size) return true;
  return lexicalScore(value, terms) > 0;
}

function lexicalScore(value: string, terms: Set<string>) {
  const haystack = normalize(value);
  return [...terms].reduce(
    (total, term) => total + Number(haystack.includes(term)),
    0,
  );
}

function relatedFactScore(left: StoredMemoryFact, right: StoredMemoryFact) {
  const leftTerms = normalizedTerms(left.text);
  const rightTerms = normalizedTerms(right.text);
  return [...leftTerms].filter((term) => rightTerms.has(term)).length;
}

function recencyScore(timestamp: string) {
  const ageDays = Math.max(0, Date.now() - Date.parse(timestamp)) / 86_400_000;
  return Math.max(0, 5 - Math.floor(ageDays / 7));
}

function authorityRank(authority: StoredMemoryFact["authority"]) {
  if (authority === "user") return 3;
  if (authority === "runtime") return 2;
  return 1;
}

function sameScope(left: MemoryScope, right: MemoryScope) {
  return left.type === right.type && left.value === right.value;
}

function scopeContains(scope: MemoryScope, value: string) {
  return normalize(scope.value ?? "").includes(normalize(value));
}

function scopeKey(scope: MemoryScope) {
  return `${scope.type}:${normalize(scope.value ?? "")}`;
}

function changeText(change: ChangeReceipt) {
  return [change.summary, ...change.files, ...change.symbols].join(" ");
}

function emptyValidation(updatedAt: string): ValidationSummary {
  return { status: "unknown", checks: [], updatedAt };
}

function nextEpoch(epoch: ExecutionEpoch, reason: string): ExecutionEpoch {
  const sequence = epoch.sequence + 1;
  const marker = epoch.id.lastIndexOf(":epoch:");
  const conversationId = marker >= 0 ? epoch.id.slice(0, marker) : epoch.id;
  return {
    id: epochId(conversationId, sequence),
    sequence,
    reason,
    startedAt: now(),
  };
}

function epochId(conversationId: string, sequence: number) {
  return `${conversationId}:epoch:${sequence}`;
}

function upsertById<T extends { id: string }>(values: T[], value: T) {
  return [...values.filter((candidate) => candidate.id !== value.id), value];
}

function upsertByReference<T extends { ref: string }>(values: T[], value: T) {
  return [...values.filter((candidate) => candidate.ref !== value.ref), value];
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function compactText(value: string, maximum: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (maximum <= 0) return "";
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximum - 1))}…`;
}

function countValueTokens(value: unknown, tokenCounter: TokenCounter) {
  return tokenCounter.count(JSON.stringify(value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function now() {
  return new Date().toISOString();
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function migrateConversation(
  legacy: LegacyStoredConversation,
): StoredConversation {
  const source = legacy.memory;
  const conversationId =
    stringField(source, "conversationId") || "conversation";
  const recentDialogue = dialogueField(source.recentDialogue);
  const completedChanges = changesField(source.completedChanges);
  const facts = legacyFacts(source, recentDialogue);
  const evidence = legacyEvidence(recentDialogue, completedChanges);
  const currentIntent = stringField(source, "currentIntent");
  const requestRef =
    recentDialogue.filter((turn) => turn.role === "user").at(-1)?.id ?? "";
  return {
    schema_version: "2.0",
    epoch: legacy.epoch,
    memory: migratedMemory(source, {
      conversationId,
      currentIntent,
      requestRef,
      facts,
      evidence,
      completedChanges,
      recentDialogue,
    }),
  };
}

function migratedMemory(
  source: Record<string, unknown>,
  migrated: {
    conversationId: string;
    currentIntent: string;
    requestRef: string;
    facts: StoredMemoryFact[];
    evidence: MemoryEvidence[];
    completedChanges: ChangeReceipt[];
    recentDialogue: DialogueTurn[];
  },
): ConversationMemory {
  return {
    conversationId: migrated.conversationId,
    userGoal: stringField(source, "userGoal"),
    currentIntent: migrated.currentIntent,
    currentUserRequestRef: migrated.requestRef,
    facts: migrated.facts,
    evidence: migrated.evidence,
    completedChanges: migrated.completedChanges,
    validationState: validationField(source.validationState),
    recentDialogue: migrated.recentDialogue,
    fallbackCheckpoints: [],
    ...(migrated.requestRef
      ? { activeTurn: { requestRef: migrated.requestRef, startedAt: now() } }
      : {}),
    updatedAt: stringField(source, "updatedAt") || now(),
  };
}

function legacyFacts(
  source: Record<string, unknown>,
  dialogue: DialogueTurn[],
) {
  const userRefs = dialogue
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.id);
  return [
    ...legacyFactGroup(
      source.persistentConstraints,
      "constraint",
      "conversation",
      userRefs,
    ),
    ...legacyFactGroup(source.acceptedDecisions, "decision", "story", userRefs),
    ...legacyFactGroup(
      source.rejectedDirections,
      "rejection",
      "story",
      userRefs,
    ),
    ...legacyFactGroup(source.unresolvedItems, "open_item", "story", userRefs),
  ];
}

function legacyFactGroup(
  value: unknown,
  kind: ProposedMemoryFact["kind"],
  durability: ProposedMemoryFact["durability"],
  evidenceRefs: string[],
) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const fact =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = stringField(fact, "value");
    return text
      ? [
          storedFact(
            { kind, text, scope: { type: "global" }, durability },
            "user",
            evidenceRefs,
          ),
        ]
      : [];
  });
}

function legacyEvidence(
  dialogue: DialogueTurn[],
  changes: ChangeReceipt[],
): MemoryEvidence[] {
  return [
    ...dialogue.map(legacyDialogueEvidence),
    ...changes.map(legacyChangeEvidence),
  ];
}

function legacyDialogueEvidence(turn: DialogueTurn): MemoryEvidence {
  if (turn.role === "user")
    return {
      type: "user_message",
      ref: turn.id,
      content: turn.content,
      created_at: turn.createdAt,
    };
  return {
    type: "assistant_turn",
    ref: turn.id,
    answer_summary: compactText(turn.content, 1_000),
    created_at: turn.createdAt,
  };
}

function legacyChangeEvidence(change: ChangeReceipt): MemoryEvidence {
  return {
    type: "change_receipt",
    ref: change.id,
    files: change.files,
    symbols: change.symbols,
    status: change.validation,
    created_at: change.updatedAt,
  };
}

function dialogueField(value: unknown): DialogueTurn[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DialogueTurn => {
    if (!item || typeof item !== "object") return false;
    const turn = item as Record<string, unknown>;
    return typeof turn.id === "string" && typeof turn.content === "string";
  });
}

function changesField(value: unknown): ChangeReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChangeReceipt => {
    if (!item || typeof item !== "object") return false;
    const change = item as Record<string, unknown>;
    return typeof change.id === "string" && Array.isArray(change.files);
  });
}

function validationField(value: unknown): ValidationSummary {
  if (!value || typeof value !== "object") return emptyValidation(now());
  const validation = value as Record<string, unknown>;
  const status = validation.status;
  if (
    status !== "failed" &&
    status !== "passed" &&
    status !== "pending" &&
    status !== "unknown"
  )
    return emptyValidation(now());
  return {
    status,
    checks: Array.isArray(validation.checks)
      ? validation.checks.filter(
          (item): item is { id: string; status: string } =>
            Boolean(
              item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).id === "string" &&
              typeof (item as Record<string, unknown>).status === "string",
            ),
        )
      : [],
    updatedAt: stringField(validation, "updatedAt") || now(),
  };
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}
