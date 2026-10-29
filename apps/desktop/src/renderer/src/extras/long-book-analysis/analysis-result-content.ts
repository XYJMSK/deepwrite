import { t } from "../../i18n";
import {
  LongBookAnalysisResultSchema,
  parseSkillMarkdown,
  updateMaterialMarkdownMetadata,
  updateSkillMarkdownMetadata,
  type CatalogLibraryEntry,
  type DeepWriteApi,
  type LongBookAnalysisOutput,
  type LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";

/** Prepare an edited preview for the existing catalog save/conflict flow. */
export function analysisResultEntry(
  draft: LongBookAnalysisResult,
  domain: "material" | "skill"
): { title: string; content: string } {
  const result = LongBookAnalysisResultSchema.safeParse(draft);
  if (!result.success) {
    throw new Error(t("extras.longBookAnalysis.resultFieldsRequired"));
  }
  const { name, description, content } = result.data;
  const updated = (
    domain === "skill"
      ? updateSkillMarkdownMetadata
      : updateMaterialMarkdownMetadata
  )(content, { name, description });
  if (!updated.updated) throw new Error(updated.message);
  if (domain === "skill") {
    const parsed = parseSkillMarkdown(updated.content);
    if (!parsed.valid) throw new Error(parsed.message);
  }
  return { title: name, content: updated.content };
}

export interface AnalysisSaveInput {
  libraryId: string;
  baseProjectRevision?: number;
}

/** Creates one library entry from an edited result. */
export async function persistAnalysisResult(
  api: DeepWriteApi,
  output: LongBookAnalysisOutput,
  draft: LongBookAnalysisResult,
  input: AnalysisSaveInput
): Promise<CatalogLibraryEntry> {
  const entry = {
    libraryId: input.libraryId,
    ...analysisResultEntry(draft, output.domain),
    ...(input.baseProjectRevision === undefined
      ? {}
      : { baseProjectRevision: input.baseProjectRevision })
  };
  if (output.domain === "material") {
    return api.catalog.createLibraryEntry({
      domain: "material",
      stageId: output.stageId,
      ...entry
    });
  } else {
    return api.catalog.createLibraryEntry({
      domain: "skill",
      stageId: output.stageId,
      ...entry
    });
  }
}

/**
 * Saves results one after another. Each created entry advances its library's
 * revision by one, so later writes to the same library use the next revision.
 */
export async function persistAnalysisResults(
  requests: readonly (AnalysisSaveInput & { id: string })[],
  persist: (id: string, input: AnalysisSaveInput) => Promise<void>
): Promise<{ saved: number; errors: unknown[] }> {
  const revisions = new Map<string, number>();
  const errors: unknown[] = [];
  let saved = 0;
  for (const { id, libraryId, baseProjectRevision } of requests) {
    const base = revisions.get(libraryId) ?? baseProjectRevision;
    try {
      await persist(id, {
        libraryId,
        ...(base === undefined ? {} : { baseProjectRevision: base })
      });
      saved += 1;
      if (base !== undefined) revisions.set(libraryId, base + 1);
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  return { saved, errors };
}
