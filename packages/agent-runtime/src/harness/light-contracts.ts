import { z } from "zod";

const relativePath = z.string().trim().min(1).max(4_096);
const editContent = z.string().max(2_097_152);

export const lightSearchCodeInputSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    scope: z.union([relativePath, z.array(relativePath).max(100)]).optional(),
    mode: z.enum(["auto", "text", "symbol", "references"]).optional(),
  })
  .strict();

export const lightReadCodeInputSchema = z
  .object({
    target: z.string().trim().min(1).max(4_096),
    view: z.enum(["auto", "raw", "outline", "symbol", "range"]).optional(),
    range: z
      .object({
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .strict()
      .refine((value) => value.endLine >= value.startLine)
      .optional(),
  })
  .strict();

const symbolEdit = z
  .object({
    kind: z.literal("symbol"),
    target: z.string().trim().min(1).max(4_096),
    action: z.enum([
      "replace",
      "replace_body",
      "insert_before",
      "insert_after",
      "delete",
    ]),
    content: editContent.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action !== "delete" && value.content === undefined)
      context.addIssue({ code: "custom", message: "content is required" });
  });

const patchEdit = z
  .object({
    kind: z.literal("patch"),
    path: relativePath.optional(),
    patch: editContent.min(1),
  })
  .strict();

export const lightEditCodeInputSchema = z
  .object({
    operations: z
      .array(z.discriminatedUnion("kind", [symbolEdit, patchEdit]))
      .min(1)
      .max(50),
  })
  .strict();

export const lightRunTaskInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("project"),
      task: z.string().trim().min(1).max(300),
      packagePath: relativePath.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("command"),
      command: z.string().trim().min(1).max(8_000),
      cwd: relativePath.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("dependency"),
      action: z.enum(["add", "remove"]),
      packages: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
      packagePath: relativePath.optional(),
    })
    .strict(),
]);

export const finishTaskInputSchema = z
  .object({ summary: z.string().trim().min(1).max(8_000) })
  .strict();

export type LightSearchCodeInput = z.infer<typeof lightSearchCodeInputSchema>;
export type LightReadCodeInput = z.infer<typeof lightReadCodeInputSchema>;
export type LightEditCodeInput = z.infer<typeof lightEditCodeInputSchema>;
export type LightRunTaskInput = z.infer<typeof lightRunTaskInputSchema>;

export type LightTaskContract = {
  acceptance_criteria?: string[];
  effect_requirement?: "none" | "source_change";
  objective?: string;
  session_id?: string;
  story_id?: string;
};

export type LightToolResult<T> =
  | { status: "ok"; data: T; receipt?: string }
  | {
      status: "blocked";
      category: "input" | "code" | "environment" | "external";
      message: string;
      recovery?: string;
      diagnosticId?: string;
    }
  | {
      status: "failed";
      category: "harness";
      message: string;
      diagnosticId: string;
    };
