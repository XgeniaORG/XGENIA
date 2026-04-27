const View = require('../../../../shared/view');
const Config = require('../../../../shared/config/config');
const ViewerTemplate = require('../templates/viewer.html');
const { ipcRenderer } = require('electron');

const remote = require('@electron/remote');

require('@xgenia/platform-electron');
require('../../../../editor/src/styles/custom-properties/colors.css');

const { platform, PlatformOS } = require('@xgenia/platform');
const { CanvasView } = require('../../../../editor/src/views/VisualCanvas/CanvasView.ts');
const { showContextMenuInPopup } = require('../../../../editor/src/views/ShowContextMenuInPopup');

const MenuDialogWidth = require('@xgenia-core-ui/components/popups/MenuDialog');

class Viewer extends View {
  constructor() {
    super();

    remote.getCurrentWindow().webContents.openDevTools();

    this.isWindows = platform.os === PlatformOS.Windows;

    this.canvasView = new CanvasView({
      onNavigationStateChanged: (state) => {
        ipcRenderer.send('viewer-navigation-state', state);
      }
    });

    ipcRenderer.on('viewer-refresh', () => {
      this.canvasView.refresh();
      ipcRenderer.send('viewer-refreshed');
    });

    ipcRenderer.on('viewer-focus', () => {
      const window = remote.getCurrentWindow();
      if (window && window.focusable) {
        window.focus();
      }
    });

    ipcRenderer.on('viewer-open-devtools', () => {
      this.canvasView.openDevTools();
    });

    ipcRenderer.on('viewer-select-node', (sender, nodeId) => {
      this.canvasView.setNodeSelected(nodeId);
    });

    ipcRenderer.on('viewer-set-zoom-factor', (sender, zf) => {
      this.canvasView.setZoomFactor(zf);
    });

    ipcRenderer.on('viewer-set-route', (sender, route) => {
      this.canvasView.setCurrentRoute(route);
    });

    ipcRenderer.on('viewer-set-inspect-mode', (sender, inspectMode) => {
      console.log('[Viewer] viewer-set-inspect-mode received:', inspectMode);
      this.canvasView.setInspectMode(inspectMode);
    });

    ipcRenderer.on('viewer-set-viewport-size', (sender, viewportSize) => {
      this.canvasView.setViewportSize(viewportSize);
    });

    ipcRenderer.on('viewer-navigate-forward', (sender) => {
      this.canvasView.navigateForward();
    });

    ipcRenderer.on('viewer-navigate-back', (sender) => {
      this.canvasView.navigateBack();
    });

    ipcRenderer.on('viewer-get-full-html', async (event) => {
      console.log('[viewer.js] Received viewer-get-full-html request');
      try {
        // Access webview via canvasView.webview
        const webview = this.canvasView.webview;
        if (!webview) {
          ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: 'Webview not found in viewer' });
          return;
        }

        const resultStr = await webview.executeJavaScript(`
          (function() {
            try {
              return JSON.stringify({
                success: true,
                html: document.documentElement.outerHTML,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString()
              });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })();
        `);
        const result = JSON.parse(resultStr);

        ipcRenderer.send('viewer-get-full-html-reply', result);
      } catch (error) {
        console.error('[viewer.js] HTML extraction error:', error);
        ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: error.message });
      }
    });

    ipcRenderer.on('viewer-capture-thumb', async (event) => {
      // LOGGING POINT 0
      console.log('[viewer.js] DEBUG POINT 0: viewer-capture-thumb handler START');
      try {
        console.log('[viewer.js] Received viewer-capture-thumb request', new Date().toISOString());

        try {
          console.log('[viewer.js] Calling canvasView.captureThumbnail()');
          const image = await this.canvasView.captureThumbnail();
          // LOGGING POINT 1
          console.log('[viewer.js] DEBUG POINT 1: After canvasView.captureThumbnail() call.');
          console.log('[viewer.js] DEBUG POINT 1.1: typeof image:', typeof image);
          if (image) {
            console.log('[viewer.js] DEBUG POINT 1.2: image.constructor.name:', image.constructor?.name);
            console.log('[viewer.js] DEBUG POINT 1.3: typeof image.toDataURL:', typeof image.toDataURL);
          } else {
            console.log('[viewer.js] DEBUG POINT 1.4: image is null or undefined.');
          }

          if (image && typeof image.toDataURL === 'function') {
            // LOGGING POINT 2
            console.log('[viewer.js] DEBUG POINT 2: image has toDataURL. Preparing to send.');

            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 250;
            const ctx = canvas.getContext('2d');
            // LOGGING POINT 2.1: Before drawImage
            console.log('[viewer.js] DEBUG POINT 2.1: canvas created, context obtained. Before ctx.drawImage.');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            // LOGGING POINT 2.2: After drawImage, before toDataURL
            console.log('[viewer.js] DEBUG POINT 2.2: After ctx.drawImage. Before canvas.toDataURL.');
            const smallImageData = canvas.toDataURL('image/jpeg', 0.7);
            // LOGGING POINT 2.3: After canvas.toDataURL
            console.log('[viewer.js] DEBUG POINT 2.3: After canvas.toDataURL. Image data length:', smallImageData ? smallImageData.length : 'null');

            const imageDataLength = smallImageData ? smallImageData.length : 'null';
            console.log(`[viewer.js] PRE-SEND CHECK: Image data acquired. Length: ${imageDataLength}. Sending via 'screenshot-captured-in-viewer'.`);

            ipcRenderer.send('screenshot-captured-in-viewer', smallImageData);
            console.log(`[viewer.js] POST-SEND: 'screenshot-captured-in-viewer' sent.`);

            return;
          } else {
            // LOGGING POINT 3
            console.error('[viewer.js] DEBUG POINT 3: Failed to get valid image (image is null/undefined or no toDataURL).');
            if (image) {
              console.error(`[viewer.js] DEBUG POINT 3.1: Image object type: ${typeof image}, constructor: ${image.constructor?.name}, has toDataURL: ${typeof image.toDataURL}`);
            }
            ipcRenderer.send('screenshot-captured-in-viewer', null);
          }
        } catch (innerError) {
          // LOGGING POINT 4
          const innerErrorMessage = innerError instanceof Error ? innerError.message : String(innerError);
          const innerErrorStack = innerError instanceof Error && innerError.stack ? innerError.stack : 'No stack available';
          console.error('[viewer.js] DEBUG POINT 4: Error in inner try block (capture/send process): ' + innerErrorMessage);
          console.error('[viewer.js] DEBUG POINT 4.1: Error message: ' + innerErrorMessage);
          console.error('[viewer.js] DEBUG POINT 4.2: Error stack: ' + innerErrorStack);
          ipcRenderer.send('screenshot-captured-in-viewer', null);
        }
      } catch (outerError) {
        // LOGGING POINT 5
        const outerErrorMessage = outerError instanceof Error ? outerError.message : String(outerError);
        const outerErrorStack = outerError instanceof Error && outerError.stack ? outerError.stack : 'No stack available';
        console.error('[viewer.js] DEBUG POINT 5: Fatal error in viewer-capture-thumb handler (outer try block): ' + outerErrorMessage);
        console.error('[viewer.js] DEBUG POINT 5.1: Error message: ' + outerErrorMessage);
        console.error('[viewer.js] DEBUG POINT 5.2: Error stack: ' + outerErrorStack);
        ipcRenderer.send('screenshot-captured-in-viewer', null);
      }
      // LOGGING POINT 6
      console.log('[viewer.js] DEBUG POINT 6: viewer-capture-thumb handler END');
    });

    // Listen for chunk acknowledgments
    ipcRenderer.on('viewer-capture-thumb-chunk-ack', (event, data) => {
      console.log(`[viewer.js] Received acknowledgment for chunk ${data.chunkIndex}/${data.totalChunks}`);
    });

    ipcRenderer.on('viewer-show-inspect-menu', ({ sender }, listItems) => {
      const items = listItems.map((item) => ({
        label: item.label,
        onClick: () => {
          sender.send('viewer-inspect-node', item.nodeId);
        }
      }));
      showContextMenuInPopup({ title: 'Nodes behind cursor', items, width: MenuDialogWidth.Large });
    });
  }

  render() {
    const el = this.bindView($(ViewerTemplate), this);
    if (this.el) this.el.append(el);
    else this.el = el;

    this.$('.webview-container').append(this.canvasView.render());
    //make sure webview is never blurred so keyboard shortcuts always work (the webview is sending key input to the editor)
    setTimeout(() => {
      //give react a chance to render before focusing the first time
      this.$('.webview-container webview')?.focus();
    }, 100);
    this.$('.webview-container webview').on('blur', (e) => {
      e.target.focus();
    });

    getLocalIPs((result) => {
      const ipAddress = result && result.length > 0 ? result[result.length - 1] : 'localhost';
      const protocol = process.env.ssl ? 'https://' : 'http://';
      const webUrl = `${protocol}${ipAddress}:${Config.PreviewServer.port}`;
      this.$('.weburl').text(webUrl).attr('href', webUrl);
    });

    this._blockClicksAfterMovingWindow();

    return this.el;
  }
  _blockClicksAfterMovingWindow() {
    remote.getCurrentWindow().on('moved', () => {
      this.blockNextClick = true;
    });

    document.addEventListener(
      'click',
      (e) => {
        if (this.blockNextClick) {
          e.stopPropagation();
          this.blockNextClick = false;
        }
      },
      true
    ); //capture phase
  }
  onAttachIconClicked() {
    ipcRenderer.send('viewer-attach');
  }
  onTitleClicked() {
    platform.openExternal(this.$('.title').text());
  }
}

function getLocalIPs(callback) {
  let ips = [];

  const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

  const pc = new RTCPeerConnection({
    // Don't specify any stun/turn servers, otherwise you will
    // also find your public IP addresses.
    iceServers: []
  });
  // Add a media line, this is needed to activate candidate gathering.
  pc.createDataChannel('');

  // onicecandidate is triggered whenever a candidate has been found.
  pc.onicecandidate = function (e) {
    if (!e.candidate) {
      // Candidate gathering completed.
      pc.close();
      callback(ips);
      return;
    }
    var ip = /^candidate:.+ (\S+) \d+ typ/.exec(e.candidate.candidate)[1];
    if (ips.indexOf(ip) === -1)
      // avoid duplicate entries (tcp/udp)
      ips.push(ip);
  };
  pc.createOffer(
    function (sdp) {
      pc.setLocalDescription(sdp);
    },
    function onerror() { }
  );
}

module.exports = Viewer;
