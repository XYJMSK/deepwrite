import { t } from "../../i18n";
import { ref, type Ref } from "vue";
import {
  RevisionAnalysisResultSchema,
  parseSkillMarkdown,
  updateSkillMarkdownMetadata,
  type DeepWriteApi,
  type RevisionAnalysisResult,
  type SkillLibrary
} from "@deepwrite/contracts/renderer";
export function createRevisionSkillSave(
  api: () => DeepWriteApi,
  result: Ref<RevisionAnalysisResult | null>
) {
  const savedEntry = ref<{ libraryId: string; entryId: string } | null>(null);
  const saving = ref(false),
    savedKey = ref("");
  const key = () =>
    JSON.stringify([
      result.value?.title,
      result.value?.description,
      result.value?.body
    ]);
  return {
    saving,
    savedEntry,
    savedKey,
    skillKey: key,
    async persistSkill(library: SkillLibrary) {
      if (saving.value) return false;
      if (library.isBuiltin)
        throw new Error(t("extras.revisionAnalysis.writableSkillRequired"));
      const draft = RevisionAnalysisResultSchema.parse(result.value);
      const currentKey = key();
      if (savedKey.value === currentKey) return false;
      const skill = updateSkillMarkdownMetadata(draft.body, {
        name: draft.title,
        description: draft.description
      });
      if (!skill.updated) throw new Error(skill.message);
      const parsed = parseSkillMarkdown(skill.content);
      if (!parsed.valid) throw new Error(parsed.message);
      saving.value = true;
      try {
        const entry = await api().catalog.createLibraryEntry({
          domain: "skill",
          libraryId: library.id,
          title: draft.title,
          content: skill.content,
          ...(library.projectRevision !== undefined
            ? { baseProjectRevision: library.projectRevision }
            : {})
        });
        savedEntry.value = { libraryId: library.id, entryId: entry.id };
        savedKey.value = currentKey;
        return true;
      } finally {
        saving.value = false;
      }
    }
  };
}
