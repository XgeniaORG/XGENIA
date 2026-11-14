const fs = require('fs');
const path = require('path');

module.exports = async function (params) {
  // The platform being built, not the machine building it: a Mac cross-building Windows or Linux
  // has nothing to notarize.
  if ((params && params.electronPlatformName) !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  // Preferred: an App Store Connect team API key. It belongs to the team, not to one person's
  // Apple ID, so it keeps working when someone's account gets locked or leaves.
  const apiKeyPath = process.env.APPLE_API_KEY;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;

  const appleId = process.env.appleId ?? process.env.APPLE_ID;
  const appleIdPassword = process.env.appleIdPassword ?? process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.appleTeamId ?? process.env.APPLE_TEAM_ID;

  let credentials;
  if (apiKeyPath && apiKeyId && apiIssuer) {
    credentials = { appleApiKey: apiKeyPath, appleApiKeyId: apiKeyId, appleApiIssuer: apiIssuer };
    console.log('Notarizing with App Store Connect API key');
  } else if (appleId && appleIdPassword) {
    credentials = { appleId, appleIdPassword, teamId: appleTeamId };
    console.log('Notarizing with Apple ID');
  } else {
    console.log('❌ No notarization credentials set, skipping notarization');
    console.log('📝 Set APPLE_API_KEY (path to .p8), APPLE_API_KEY_ID and APPLE_API_ISSUER,');
    console.log('   or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
    return;
  }

  const appId = 'com.xgenia.nb';
  const appPath = path.join(params.appOutDir, `${params.packager.appInfo.productFilename}.app`);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot find application at: ${appPath}`);
  }

  console.log(`Notarizing ${appId} found at ${appPath}`);

  try {
    const { notarize } = require('@electron/notarize');
    await notarize({
      tool: 'notarytool',
      appBundleId: appId,
      appPath: appPath,
      ...credentials
    });
    console.log(`✅ Successfully notarized ${appId} using notarytool`);
  } catch (notarytoolError) {
    console.error('❌ Notarization failed:', notarytoolError);
    throw notarytoolError;
  }

  console.log(`Done notarizing ${appId}`);
};