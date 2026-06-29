import { omitRelationshipBodySections } from "./body-sections.js";
import {
  loadTaskShowModel,
  type LoadTaskShowOptions,
  type TaskShowModel,
} from "./show.js";

export type TaskPromptModel = TaskShowModel;

export type LoadTaskPromptOptions = LoadTaskShowOptions;

export async function loadTaskPromptModel(
  options: LoadTaskPromptOptions,
): Promise<TaskPromptModel> {
  const showModel = await loadTaskShowModel(options);
  return {
    ...showModel,
    body: {
      ...showModel.body,
      sections: omitRelationshipBodySections(showModel.body.sections),
    },
  };
}
