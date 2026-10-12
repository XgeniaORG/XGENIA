// Content-Type for a url the project web server serves. Split out of web-server.js so it can be
// tested without starting a server.

const nodePath = require('path');

function contentTypeForUrl(url) {
  // The extension of the PATH, never of the whole url: `?v=<cache-buster>` made every versioned
  // asset url match nothing and go out as text/html (2026-09-17). Case-insensitive, and decoded so
  // `spin%20button.png` reads like `spin button.png`.
  var pathname = String(url || '').split(/[?#]/)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    /* malformed escape: read it raw */
  }
  var extname = nodePath.extname(pathname).toLowerCase();
  var contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.webp':
      contentType = 'image/webp';
      break;
    case '.gif':
      contentType = 'image/gif';
      break;
    case '.jpg':
      contentType = 'image/jpeg';
      break;
    // (2026-08-27, export 1787803023693) THE MISSING CASES WERE SERVING text/html.
    // A generated reel-dog-win.webm reached the browser with the right bytes (valid EBML
    // magic, correct length) and content-type text/html — this switch's default — so the
    // <video> element fired `error` and every transparent-webm win animation "vanished".
    // Sessions across three days blamed alpha compositing, hide-latches, and the video
    // model for what was this switch all along; one session started base64-inlining a
    // 3MB clip into a node parameter to get around it. Sweep, not a one-extension fix:
    // every asset family the engine actually loads (video, audio for the Sound node,
    // fonts now that writes fetch them, modern image formats) gets its real type.
    // The .wav case also fell through into .mp4 (the eslint-disable was masking it),
    // so wav files were served as video/mp4.
    case '.wav':
      contentType = 'audio/wav';
      break;
    case '.mp3':
      contentType = 'audio/mpeg';
      break;
    case '.ogg':
      contentType = 'audio/ogg';
      break;
    case '.mp4':
    case '.m4v':
      contentType = 'video/mp4';
      break;
    case '.webm':
      contentType = 'video/webm';
      break;
    case '.jpeg':
      contentType = 'image/jpeg';
      break;
    case '.avif':
      contentType = 'image/avif';
      break;
    case '.woff':
      contentType = 'font/woff';
      break;
    case '.woff2':
      contentType = 'font/woff2';
      break;
    case '.otf':
      contentType = 'font/otf';
      break;
    case '.wasm':
      contentType = 'application/wasm';
      break;
    case '.svg':
      contentType = 'image/svg+xml';
      break;
    case '.ttf':
      contentType = 'font/ttf';
      break;
  }

  return contentType;
}

module.exports = { contentTypeForUrl };
