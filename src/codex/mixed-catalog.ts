import type { ResolvedFavorite } from '../favorites-resolver.js';
import { catalogEntryFromModel, type CodexCatalogFile, type CodexCatalogModel } from './catalog.js';
import { codexCliFavoritesSlug } from './favorites-catalog.js';

export interface MixedCatalogEntry {
  resolved: ResolvedFavorite;
  slug: string;
}

export interface ComposeMixedCodexCatalogInput {
  nativeModels: CodexCatalogModel[];
  visibleRelay: MixedCatalogEntry[];
  subagentRelay: MixedCatalogEntry[];
  selectedSlug: string;
  externalMultiAgentVersion: 'v1' | 'v2';
}

const EXTERNAL_MODEL_IDENTITY =
  'You are the selected external model operating as a coding agent inside Codex.';

function externalModelMessages(templateMessages: unknown): unknown {
  if (!templateMessages || typeof templateMessages !== 'object' || Array.isArray(templateMessages)) {
    return templateMessages;
  }
  const messages = { ...(templateMessages as Record<string, unknown>) };
  if (typeof messages.instructions_template === 'string') {
    messages.instructions_template = messages.instructions_template.replace(
      /^You are Codex,[^\n]*?(?:GPT-?\d(?:\.\d+)?|OpenAI)[^\n]*?\.\s*/i,
      `${EXTERNAL_MODEL_IDENTITY} `,
    );
  }
  return messages;
}

function externalCatalogEntryFromTemplate(
  template: CodexCatalogModel,
  entry: MixedCatalogEntry,
  priority: number,
  visibility: 'list' | 'hide',
  multiAgentVersion: 'v1' | 'v2',
): CodexCatalogModel {
  const resolvedModel = entry.resolved.model as Parameters<typeof catalogEntryFromModel>[0];
  const generated = catalogEntryFromModel(
    resolvedModel,
    entry.resolved.providerName,
    priority,
    false,
    entry.slug,
  );
  const external: CodexCatalogModel = {
    ...template,
    ...generated,
    slug: entry.slug,
    display_name: `${generated.display_name} · ${entry.resolved.providerName}`,
    visibility,
    multi_agent_version: multiAgentVersion,
  };
  // The native catalog's model_messages contain useful Codex agent behavior,
  // but their opening identity names the native OpenAI model. Keep the agent
  // instructions while making that identity provider-neutral. The native
  // comp_hash no longer describes the modified instructions and must not be
  // advertised for an external model.
  external.model_messages = externalModelMessages(template.model_messages);
  delete external.comp_hash;
  return external;
}

export function composeMixedCodexCatalog(input: ComposeMixedCodexCatalogInput): CodexCatalogFile {
  const template = input.nativeModels.find(model => model.slug === 'gpt-5.5')
    ?? input.nativeModels.find(model => model.visibility === 'list')
    ?? input.nativeModels[0];
  if (!template) throw new Error('Native Codex catalog has no template model');

  const hasSubagents = input.subagentRelay.length > 0;
  const models: CodexCatalogModel[] = input.nativeModels.map(model => {
    if (!hasSubagents || model.visibility !== 'list' || model.multi_agent_version === 'disabled') return model;
    return { ...model, multi_agent_version: input.externalMultiAgentVersion };
  });
  const added = new Set(models.map(model => model.slug));
  const visible = [...input.visibleRelay].sort((a, b) => (a.slug === input.selectedSlug ? -1 : 0) - (b.slug === input.selectedSlug ? -1 : 0));
  const subagentSlugs = new Set(input.subagentRelay.map(entry => entry.slug));
  for (const entry of [...visible, ...input.subagentRelay]) {
    if (added.has(entry.slug)) continue;
    added.add(entry.slug);
    models.push(externalCatalogEntryFromTemplate(
      template,
      entry,
      entry.slug === input.selectedSlug ? 0 : models.length,
      'list',
      hasSubagents || subagentSlugs.has(entry.slug) ? input.externalMultiAgentVersion : 'v1',
    ));
  }
  return { models };
}

export function mixedRelaySlug(providerId: string, modelId: string): string {
  return codexCliFavoritesSlug(providerId, modelId);
}
