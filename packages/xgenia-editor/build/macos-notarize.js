const fs = require('fs');
const path = require('path');

module.exports = async function (params) {
  if (process.platform !== 'darwin') {
    return;
  }

  const appleId = process.env.appleId ?? process.env.APPLE_ID;
  const appleIdPassword = process.env.appleIdPassword ?? process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.appleTeamId ?? process.env.APPLE_TEAM_ID;


  // Check for required environment variables
  if (!appleId || !appleIdPassword) {
    console.log('❌ Apple ID credentials not set, skipping notarization');
    console.log('📝 To enable notarization, set the following environment variables:');
    console.log('   - appleId: Your Apple ID email address');
    console.log('   - appleIdPassword: Your app-specific password');
    console.log('   - appleTeamId: Your Apple Developer Team ID (optional)');
    console.log('');
    console.log('💡 You can create a .env file in the project root with these variables');
    console.log('📋 See env-template.txt for an example');
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
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: appleTeamId
    });
    console.log(`✅ Successfully notarized ${appId} using notarytool`);
  } catch (notarytoolError) {
    console.error('❌ Notarization failed:', notarytoolError);
    throw notarytoolError;
    // console.log('⚠️  notarytool failed, falling back to legacy notarization...');

    // // Fallback to legacy electron-notarize
    // const electron_notarize = require('electron-notarize');
    // await electron_notarize.notarize({
    //   appBundleId: appId,
    //   appPath: appPath,
    //   appleId: process.env.appleId,
    //   appleIdPassword: process.env.appleIdPassword
    // });
    // console.log(`✅ Successfully notarized ${appId} using legacy method`);
  }

  console.log(`Done notarizing ${appId}`);
};