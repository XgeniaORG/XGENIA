const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const JSONStorage = require('../../shared/utils/jsonstorage');
const { app } = require('electron');
const fs = require('fs');
const nodePath = require('path');

/**
 * Where an image the design-tool plugin sends is saved: a plain file name (the Figma plugin sends
 * `<imageHash>.png`) inside the open project, or null. Anything with a directory part is refused.
 */
function imageTargetPath(projectDirectory, name) {
  if (!projectDirectory || typeof name !== 'string') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name) || name.includes('..')) return null;
  const root = nodePath.resolve(projectDirectory);
  const target = nodePath.resolve(root, name);
  return nodePath.dirname(target) === root ? target : null;
}

let win;
let clientSockets = [];

let projectName = null;

function sendProjectName(ws, name) {
  ws.send(
    JSON.stringify({
      type: 'projectInfo',
      data: {
        name: projectName
      }
    })
  );
}

function start(projectGetInfo) {
  const port = Number(process.env.XGENIAPORT || 8574) + 1; //use standard XGENIA port + 1

  // Local only: the design-tool plugin connects to ws://localhost.
  var wss = new WebSocketServer({ port, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    clientSockets.push(ws);

    ws.on('close', () => {
      const idx = clientSockets.findIndex((w) => w === ws);
      if (idx !== -1) clientSockets.splice(idx, 1);
    });

    ws.send(
      JSON.stringify({
        type: 'editorInfo',
        data: {
          version: app.getVersion()
        }
      })
    );

    sendProjectName(ws, projectName);

    let imageName;
    ws.on('message', (data, isBinary) => {
      const message = isBinary ? data : data.toString();

      if (message instanceof Uint8Array) {
        //got image
        const name = imageName; //async hax trickery
        projectGetInfo((local) => {
          const target = imageTargetPath(local && local.projectDirectory, name);
          if (!target) {
            console.warn('[DesignToolImport] Refused an image name that is not a plain file name in the project:', String(name).slice(0, 100));
            return;
          }
          fs.writeFileSync(target, message);
        });
      } else {
        const request = JSON.parse(message);

        if (request.type === 'export') {
          win.send('import-nodeset', request.data.nodeset);
          win.show(); //focus window
        } else if (request.type === 'exportImageName') {
          imageName = request.name;
        } else if (request.type === 'exportProjectMetadata') {
          win.send('import-projectmetadata', request.data.metadata);
        }
      }
    });
  });
}

function setWindow(window) {
  win = window;
}

function setProjectName(name) {
  projectName = name;
  clientSockets.forEach((ws) => sendProjectName(ws, name));
}

module.exports = {
  imageTargetPath,
  start,
  setWindow,
  setProjectName
};
