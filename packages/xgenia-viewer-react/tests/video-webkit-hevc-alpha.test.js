// (2026-10-05, leprechaun-cluster on Safari) A transparent WebM showed as a grey box on Safari and
// iOS: WebKit does not render VP9 alpha. The Video component offers the same-named .mov (HEVC with
// alpha) first on WebKit, falling back to the .webm. This pins the name mapping.
const { hevcAlphaSiblingOf } = require('../src/components/visual/Video/Video');

describe('hevcAlphaSiblingOf', () => {
  test('a .webm URL maps to the .mov beside it, keeping the time fragment or query', () => {
    expect(hevcAlphaSiblingOf('https://g.vercel.app/assets/video/idle.webm#t=0.01')).toBe('https://g.vercel.app/assets/video/idle.mov#t=0.01');
    expect(hevcAlphaSiblingOf('/assets/video/Idle.WEBM?v=2')).toBe('/assets/video/Idle.mov?v=2');
    expect(hevcAlphaSiblingOf('assets/a.b.webm')).toBe('assets/a.b.mov');
  });
  test('anything else has no sibling', () => {
    expect(hevcAlphaSiblingOf('https://g.vercel.app/assets/intro.mp4#t=0.01')).toBeNull();
    expect(hevcAlphaSiblingOf('data:video/webm;base64,GkXfo')).toBeNull();
    expect(hevcAlphaSiblingOf('/assets/webm/clip.mp4')).toBeNull();
  });
});
