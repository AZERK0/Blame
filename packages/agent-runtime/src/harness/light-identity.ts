import { createHash } from "node:crypto";

export type SourceRevisionRef = {
  base_commit?: string;
  overlay_merkle_root: string;
  source_revision_id: string;
};

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
