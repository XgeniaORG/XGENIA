import type { AIProvenance } from './assetMeta';

/** One short phrase for how the AI made a file, for rows and captions. Pure. */
export function describeAiSource(ai: AIProvenance | undefined | null): string {
  if (!ai) return '';
  const source = String(ai.source || '');
  if (source === 'layer-split') return 'cut by a layer split';
  if (/img2img|edit/i.test(source) || /\/edit\b/i.test(String(ai.model || ''))) return 'AI edit';
  if (/generat/i.test(source) || ai.prompt) return 'AI generated';
  return source ? source.replace(/[_-]+/g, ' ') : 'AI';
}
