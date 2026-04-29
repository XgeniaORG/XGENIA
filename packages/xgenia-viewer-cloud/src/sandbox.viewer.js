import { CloudRunner } from '.';

const _runner = new CloudRunner({
  webSocketClass: WebSocket,
  connectToEditor: true,
  editorAddress: 'ws://localhost:8574',
  enableDebugInspectors: true
});

_runner.runtime.graphModel.on('editorImportComplete', () => {
  ipcRenderer.send('xgenia-cf-has-loaded-project');
});

const handleRequest = async (functionName, req) => {
  return await _runner.run(functionName, req);
};

const eventQueue = [];
let hasScheduledProcessJobs = false;
const _xgenia_process_jobs = () => {
  hasScheduledProcessJobs = false;
  while (eventQueue.length > 0) {
    const cb = eventQueue.shift();
    cb();
  }
};

const _setImmediate = window.setImmediate;
window.setImmediate = (cb) => {
  eventQueue.push(cb);
  if (!hasScheduledProcessJobs) {
    hasScheduledProcessJobs = true;
    _setImmediate(_xgenia_process_jobs);
  }
};

const _fetch_response_handlers = {};
const _fetch = window.fetch;
window.fetch = function (url, args) {
  if (args && args.platform === 'node') {
    return new Promise((resolve, reject) => {
      // Perform the fetch via the host node platform
      const token = Math.random().toString(26).slice(2);
      _fetch_response_handlers[token] = (args) => {
        if (args.error === undefined) {
          const res = {
            body: args.body,
            status: args.status,
            headers: args.headers,
            ok: args.status === 200 || args.status === 201
          };
          res.json = () => {
            try {
              return Promise.resolve(JSON.parse(res.body));
            } catch (e) {
              return Promise.reject('Failed to parse JSON response');
            }
          };
          res.text = () => {
            return Promise.resolve(res.body);
          };

          resolve(res);
        } else reject(args.error);
      };

      ipcRenderer.send('xgenia-cf-fetch', {
        url,
        method: args.method,
        token,
        headers: JSON.parse(JSON.stringify(args.headers)),
        body: args.body
      });
    });
  } else return _fetch(url, args);
};

ipcRenderer.on('xgenia-cf-fetch-response', async function (event, args) {
  if (typeof _fetch_response_handlers[args.token] === 'function') {
    typeof _fetch_response_handlers[args.token](args);
    delete _fetch_response_handlers[args.token];
  }
});

ipcRenderer.on('xgenia-cf-request', async function (event, args) {
  if (args.cloudService) {
    window._xgenia_cloudservices = {
      endpoint: args.cloudService.endpoint,
      appId: args.cloudService.appId,
      masterKey: args.cloudService.masterKey
    };
  }

  console.info(`Cloud function ${args.function} called`);

  try {
    // args.function
    // args.headers
    // args.body

    const res = await handleRequest(args.function, {
      body: args.body,
      headers: args.headers
    });

    console.info(`Cloud function ${args.function} response [${res.statusCode}]`);

    event.sender.send('xgenia-cf-response', Object.assign({}, res, { token: args.token }));
  } catch (e) {
    console.error(`Cloud function ${args.function} response [400] message: ${e.message}`);

    event.sender.send('xgenia-cf-response', {
      token: args.token,
      statusCode: 400,
      body: JSON.stringify({ error: e.message })
    });
  }
});
