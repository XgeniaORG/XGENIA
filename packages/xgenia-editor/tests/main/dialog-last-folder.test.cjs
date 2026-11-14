const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rememberDialogFolder } = require('../../src/main/src/dialog-last-folder');

function fakeDialog(picks) {
  const calls = [];
  const dialog = {
    async showOpenDialog(...args) {
      calls.push(args);
      return { canceled: false, filePaths: [picks.shift()] };
    },
    showOpenDialogSync(...args) {
      calls.push(args);
      return [picks.shift()];
    },
    async showSaveDialog(...args) {
      calls.push(args);
      const filePath = picks.shift();
      return { canceled: !filePath, filePath: filePath || '' };
    },
    showSaveDialogSync(...args) {
      calls.push(args);
      return picks.shift() || '';
    }
  };
  rememberDialogFolder(dialog);
  return { dialog, calls };
}

test('first dialog is untouched, the next starts where the user last picked', async () => {
  const { dialog, calls } = fakeDialog(['/work/art/hero.png', '/work/art/villain.png']);
  await dialog.showOpenDialog({ properties: ['openFile'] });
  assert.deepEqual(calls[0], [{ properties: ['openFile'] }]);
  await dialog.showOpenDialog({ properties: ['openFile'] });
  assert.deepEqual(calls[1], [{ properties: ['openFile'], defaultPath: '/work/art' }]);
});

test('an explicit defaultPath wins', async () => {
  const { dialog, calls } = fakeDialog(['/a/b.png', '/c/d.png']);
  await dialog.showOpenDialog({});
  await dialog.showOpenDialog({ defaultPath: '/elsewhere' });
  assert.equal(calls[1][0].defaultPath, '/elsewhere');
});

test('the window-first signature keeps the window and patches the options', async () => {
  const win = { id: 1 };
  const { dialog, calls } = fakeDialog(['/proj/out.zip', '/proj/again.zip']);
  await dialog.showSaveDialog(win, { title: 'Export' });
  await dialog.showSaveDialog(win, { title: 'Export' });
  assert.equal(calls[1][0], win);
  assert.deepEqual(calls[1][1], { title: 'Export', defaultPath: '/proj' });
});

test('a cancelled save remembers nothing; sync variants remember too', () => {
  const { dialog, calls } = fakeDialog(['', '/x/y.txt', '/z.txt']);
  dialog.showSaveDialogSync({});
  dialog.showOpenDialogSync({});
  assert.equal(calls[1][0].defaultPath, undefined);
  dialog.showOpenDialogSync();
  assert.deepEqual(calls[2], [{ defaultPath: '/x' }]);
});

test('a folder picker remembers the folder picked, not its parent', async () => {
  const { dialog, calls } = fakeDialog(['/work/art', '/work/art/x.png']);
  await dialog.showOpenDialog({ properties: ['openDirectory'] });
  await dialog.showOpenDialog({ properties: ['openFile'] });
  assert.equal(calls[1][0].defaultPath, '/work/art');
});
