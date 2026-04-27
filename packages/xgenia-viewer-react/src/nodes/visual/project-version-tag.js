import PropTypes from 'prop-types';

import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

// removed unused uuidv4 helper

function toDateOnly(value) {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
}

function toDateTimeString(value) {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    const iso = d.toISOString();
    const datePart = iso.split('T')[0];
    const timePart = iso.split('T')[1].split('.')[0];
    return `${datePart} ${timePart}`;
  } catch (e) {
    return null;
  }
}

async function fetchProjectJson() {
  const res = await fetch('/project.json', { method: 'GET' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = {};
  }
  const lastModified = res.headers ? res.headers.get('last-modified') : undefined;
  return { json, text, lastModified };
}

async function sha256Hex(input) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(input || '');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    // fall through to fnv1a fallback
  }
  return fnv1aHex(input || '');
}

function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function extractTemplateVersionFromMetadata(projectJson) {
  const meta = (projectJson && projectJson.metadata) || {};
  const url = meta.templateUrl || meta.templateURL || meta.projectTemplate || meta.template || meta.templateSource;
  if (typeof url === 'string' && url) {
    const fname = url.split('/').pop() || '';
    return fname.replace(/\.zip$/i, '');
  }
  return undefined;
}

async function resolveTemplateVersion(projectName, projectJson) {
  // Prefer explicit template URL stored in project metadata
  const fromMeta = extractTemplateVersionFromMetadata(projectJson);
  if (fromMeta) return fromMeta;

  try {
    const res = await fetch('https://docsapp.xgenia.com/projecttemplates/index.json', { method: 'GET' });
    if (!res.ok) return 'unknown';
    const list = await res.json();
    if (!Array.isArray(list)) return 'unknown';
    let match = list.find((t) => {
      const p = (t && t.projectURL) || '';
      const fname = p.split('/').pop() || '';
      return fname.toLowerCase().startsWith((projectName || '').toLowerCase());
    });
    if (!match) match = list.find((t) => (t.title || '').toLowerCase().includes((projectName || '').toLowerCase()));
    if (match && match.projectURL) {
      const fname = match.projectURL.split('/').pop() || '';
      return fname.replace(/\.zip$/i, '');
    }
  } catch (e) {
    /* no-op */
  }

  return 'unknown';
}

function ProjectVersionTagComponent(props) {
  const style = {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '2px',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '16px',
    color: '#333',
    ...(props.style || {})
  };
  const node = props && props.xgeniaNode;
  const values = (node && node._internal && node._internal.values) || {};
  return (
    <div style={style} className={['xgenia-project-version-tag', props.className].filter(Boolean).join(' ')}>
      <div>{`projectIntegrityHash: ${values.projectIntegrityHash || ''}`}</div>
      <div>{`timestamp: ${values.timestamp || ''}`}</div>
      <div>{`templateVersion: ${values.templateVersion || ''}`}</div>
      <div>{`buildId: ${values.buildId || ''}`}</div>
    </div>
  );
}

ProjectVersionTagComponent.propTypes = {
  style: PropTypes.object,
  className: PropTypes.string,
  xgeniaNode: PropTypes.any
};

const ProjectVersionTagNode = {
  name: 'Project Version Tag',
  docs: 'https://docsapp.xgenia.com/nodes/visual/project-version-tag',
  mountedInput: false,
  connectionPanel: {
    groupPriority: ['General', 'Style', 'Mounted', 'Hover Events', 'Pointer Events']
  },
  getReactComponent() {
    return ProjectVersionTagComponent;
  },
  xgeniaNodeAsProp: true,
  allowChildren: false,
  initialize() {
    this.wantsToBeMounted = true;
    this._internal = this._internal || {};
    this._internal.values = { projectIntegrityHash: '', timestamp: '', templateVersion: '', buildId: '' };
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue() {
        this.scheduleAfterInputsHaveUpdated(async () => {
          try {
            const { json: projectJson, text: projectText, lastModified } = await fetchProjectJson();
            const projectIntegrityHash = await sha256Hex(projectText);
            // Use only the project's file timestamp; do not fallback to current time
            const dateTime = toDateTimeString(lastModified) || '';
            let dateOnly = toDateOnly(lastModified) || (dateTime ? dateTime.split(' ')[0] : '');
            const projectName = (projectJson && projectJson.name) || '';
            const templateVersion = await resolveTemplateVersion(projectName, projectJson);
            const buildId = `build_${dateOnly}_${templateVersion}`;
            this._internal.values = { projectIntegrityHash, timestamp: dateTime, templateVersion, buildId };
            this.flagOutputDirty('projectIntegrityHash');
            this.flagOutputDirty('timestamp');
            this.flagOutputDirty('templateVersion');
            this.flagOutputDirty('buildId');
            this.forceUpdate();
          } catch (e) {
            // ignore
          }
        });
      }
    }
  },
  outputs: {
    projectIntegrityHash: {
      displayName: 'Project Id',
      group: 'Version',
      type: 'string',
      getter: function () {
        return (this._internal && this._internal.values && this._internal.values.projectIntegrityHash) || '';
      }
    },
    timestamp: {
      displayName: 'Timestamp',
      group: 'Version',
      type: 'string',
      getter: function () {
        return (this._internal && this._internal.values && this._internal.values.timestamp) || '';
      }
    },
    templateVersion: {
      displayName: 'Template Version',
      group: 'Version',
      type: 'string',
      getter: function () {
        return (this._internal && this._internal.values && this._internal.values.templateVersion) || '';
      }
    },
    buildId: {
      displayName: 'Build Id',
      group: 'Version',
      type: 'string',
      getter: function () {
        return (this._internal && this._internal.values && this._internal.values.buildId) || '';
      }
    }
  },
  defaultCss: {
    flexShrink: 0,
    position: 'relative',
    display: 'flex',
    width: 'fit-content',
    height: 'fit-content',
    padding: '6px 8px',
    backgroundColor: '#F4F4F4',
    borderRadius: '4px',
    border: '1px solid #E0E0E0'
  }
};

NodeSharedPortDefinitions.addDimensions(ProjectVersionTagNode, { defaultSizeMode: 'contentSize', contentLabel: 'Tag' });
NodeSharedPortDefinitions.addTransformInputs(ProjectVersionTagNode);
NodeSharedPortDefinitions.addMarginInputs(ProjectVersionTagNode);
NodeSharedPortDefinitions.addSharedVisualInputs(ProjectVersionTagNode);
NodeSharedPortDefinitions.addAlignInputs(ProjectVersionTagNode);
NodeSharedPortDefinitions.addPointerEventOutputs(ProjectVersionTagNode);

export default createNodeFromReactComponent(ProjectVersionTagNode);
