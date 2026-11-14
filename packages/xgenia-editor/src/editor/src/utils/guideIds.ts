// data-guide ids: stable names for the parts of the editor a lesson can point at. Components only
// carry the attribute; nothing in the editor reads it (the optional coach layer for lessons does).

export const GUIDE_ATTR = 'data-guide';

/**
 * Rail buttons are registered under router ids that grew up over time ('maths-panel',
 * 'versioncontrol', two different chat ids depending on how the panel loads). Lessons use one short
 * name per panel instead, so a renamed router id does not break every lesson that points at it.
 */
const RAIL_SHORT_NAMES: Record<string, string> = {
  ChatPanel: 'chat',
  'chat-panel': 'chat',
  components: 'components',
  hierarchy: 'hierarchy',
  search: 'search',
  assets: 'assets',
  'project-styles': 'styles',
  'maths-panel': 'maths',
  'cloud-functions': 'cloudFunctions',
  'image-editor': 'imageEditor',
  history: 'history',
  versioncontrol: 'versionControl',
  cloudservice: 'cloudServices',
  settings: 'settings',
  'node-references': 'nodeReferences',
  'rail-overflow': 'more'
};

const camel = (id: string) => id.replace(/[-_\s]+(\w)/g, (_, c: string) => c.toUpperCase());

/** `rail.<short name>` for a rail button's router id; unknown ids fall back to their camel-cased id. */
export function railGuideId(routerId: string): string {
  return `rail.${RAIL_SHORT_NAMES[routerId] ?? camel(routerId)}`;
}
