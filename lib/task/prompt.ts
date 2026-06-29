import type { CanonicalTaskBodySection } from "./canonical.js";
import {
  loadTaskShowModel,
  type LoadTaskShowOptions,
  type TaskShowModel,
} from "./show.js";

export interface TaskPromptModel extends TaskShowModel {}

export interface LoadTaskPromptOptions extends LoadTaskShowOptions {}

const RELATIONSHIP_SECTION_TITLE = "relationships";

function visibleBodySections(
  sections: CanonicalTaskBodySection[],
): CanonicalTaskBodySection[] {
  return sections.filter(
    (section) => section.title.trim().toLowerCase() !== RELATIONSHIP_SECTION_TITLE,
  );
}

export async function loadTaskPromptModel(
  options: LoadTaskPromptOptions,
): Promise<TaskPromptModel> {
  const task = await loadTaskShowModel(options);
  return {
    ...task,
    body: {
      ...task.body,
      sections: visibleBodySections(task.body.sections),
    },
  };
}
