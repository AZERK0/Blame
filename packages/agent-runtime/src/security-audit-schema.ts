const locationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string" },
    startLine: { type: "number" },
    endLine: { type: "number" },
    symbol: { type: "string" },
  },
} as const;

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string" },
    location: locationSchema,
    code: { type: "string" },
  },
} as const;

const taxonomySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cwe: { type: "array", items: { type: "string" } },
    owasp: { type: "array", items: { type: "string" } },
    asvs: { type: "array", items: { type: "string" } },
  },
} as const;

const threatModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "assets",
    "actors",
    "trustBoundaries",
    "attackerInputs",
    "securityInvariants",
  ],
  properties: {
    assets: { type: "array", items: { type: "string" } },
    actors: { type: "array", items: { type: "string" } },
    trustBoundaries: { type: "array", items: { type: "string" } },
    attackerInputs: { type: "array", items: { type: "string" } },
    securityInvariants: { type: "array", items: { type: "string" } },
  },
} as const;

export const securityDiscoveryResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["threatModel", "candidates", "inspectedPaths", "limitations"],
  properties: {
    threatModel: threatModelSchema,
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "summary",
          "vulnerabilityFamily",
          "rootControl",
          "component",
          "attacker",
          "locations",
          "evidence",
          "taxonomy",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          vulnerabilityFamily: { type: "string" },
          rootControl: { type: "string" },
          component: { type: "string" },
          attacker: { type: "string" },
          asset: { type: "string" },
          locations: { type: "array", items: locationSchema },
          evidence: { type: "array", items: evidenceSchema },
          taxonomy: taxonomySchema,
        },
      },
    },
    inspectedPaths: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;

export const securityValidationResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "rejected", "inspectedPaths", "limitations"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidateIds",
          "title",
          "severity",
          "confidence",
          "priority",
          "taxonomy",
          "attacker",
          "rootCause",
          "attackPath",
          "impact",
          "evidence",
          "affectedLocations",
          "remediation",
          "rationale",
          "counterEvidence",
        ],
        properties: {
          candidateIds: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low"] },
          confidence: { enum: ["high", "medium", "low"] },
          priority: { enum: ["p0", "p1", "p2", "p3"] },
          taxonomy: taxonomySchema,
          attacker: { type: "string" },
          asset: { type: "string" },
          rootCause: {
            type: "object",
            additionalProperties: false,
            required: ["summary"],
            properties: {
              summary: { type: "string" },
              location: locationSchema,
            },
          },
          attackPath: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: {
                label: { type: "string" },
                location: locationSchema,
              },
            },
          },
          impact: { type: "string" },
          evidence: { type: "array", items: evidenceSchema },
          affectedLocations: { type: "array", items: locationSchema },
          remediation: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "guidance"],
            properties: {
              summary: { type: "string" },
              guidance: { type: "array", items: { type: "string" } },
            },
          },
          rationale: { type: "string" },
          counterEvidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateIds", "reason"],
        properties: {
          candidateIds: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
    inspectedPaths: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;
