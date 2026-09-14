const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * afterAllArtifactBuild — notarize and staple the DMG.
 *
 * `afterSign` (./macos-notarize.js) notarizes and staples XGENIA.app, and that half
 * works: the build log says "Successfully notarized com.xgenia.nb". But afterSign runs
 * on the .app BEFORE the disk image is assembled, so the .dmg we actually ship carried
 * no ticket of its own.
 *
 * That is what a user sees. macOS runs its own Gatekeeper assessment on a downloaded,
 * quarantined disk image when it is mounted, and an un-notarized image is refused with
 * "Apple could not verify XGENIA is free of malicious software" — however well signed
 * the app inside it is. Apple's own guidance is explicit: if you distribute in a disk
 * image, notarize the disk image.
 *
 * Nothing else is missing. electron-builder already codesigns the DMG with the same
 * identity (dmg-builder runs `codesign --sign` on the finished image), and
 * @electron/notarize submits a .dmg path straight to notarytool — no zip step, and it
 * skips the codesign pre-check for disk images — then staples the ticket to it.
 *
 * Stapling rewrites the .dmg in place, so its size and hash change after this hook.
 * Nothing consumes those: the auto-updater was removed, and the `latest*.yml` manifests
 * are deliberately not published for nightlies (see scripts/build-pack.ts).
 */
module.exports = async function notarizeDmgArtifacts(buildResult) {
  if (process.platform !== 'darwin') {
    return [];
  }

  const dmgs = (buildResult && buildResult.artifactPaths ? buildResult.artifactPaths : []).filter((p) =>
    p.toLowerCase().endsWith('.dmg')
  );

  if (dmgs.length === 0) {
    return [];
  }

  // Same env names the app hook reads, so one set of secrets covers both halves.
  const appleId = process.env.appleId ?? process.env.APPLE_ID;
  const appleIdPassword = process.env.appleIdPassword ?? process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.appleTeamId ?? process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword) {
    // A local build without credentials must still finish. Say plainly what the
    // resulting file will do on someone else's Mac, rather than logging "skipped".
    console.log('❌ Apple ID credentials not set, skipping DMG notarization');
    console.log(
      `⚠️  ${dmgs.length} disk image(s) will ship WITHOUT a notarization ticket — macOS will` +
        ' refuse to open them on another machine.'
    );
    console.log('📝 Set appleId / APPLE_ID and appleIdPassword / APPLE_APP_SPECIFIC_PASSWORD to enable it.');
    return [];
  }

  const { notarize } = require('@electron/notarize');

  for (const dmg of dmgs) {
    if (!fs.existsSync(dmg)) {
      throw new Error(`Cannot find disk image at: ${dmg}`);
    }

    // A stapled ticket means this exact file already went through the notary service.
    // Re-submitting costs minutes of CI time and changes nothing.
    if (isStapled(dmg)) {
      console.log(`✅ ${path.basename(dmg)} already carries a notarization ticket, skipping`);
      continue;
    }

    console.log(`Notarizing disk image ${path.basename(dmg)}`);

    // Failures throw, exactly as the app hook does: a build that silently produced an
    // unopenable download is worse than a build that stops and says why.
    await notarize({
      tool: 'notarytool',
      appPath: dmg,
      appleId,
      appleIdPassword,
      teamId: appleTeamId
    });

    console.log(`✅ Successfully notarized and stapled ${path.basename(dmg)}`);
  }

  // The images were modified in place — there is no new artifact to publish.
  return [];
};

/** True when `xcrun stapler validate` finds a ticket already attached. */
function isStapled(filePath) {
  try {
    execFileSync('xcrun', ['stapler', 'validate', filePath], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}
