const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  console.warn('⚠️  dotenv not found or .env file missing');
}

const credentials = {
  appleId: process.env.appleId ?? process.env.APPLE_ID,
  password: process.env.appleIdPassword ?? process.env.APPLE_APP_SPECIFIC_PASSWORD,
  teamId: process.env.appleTeamId ?? process.env.APPLE_TEAM_ID
};

console.log('--- 🔍 Notarization Verification ---');

// 1. Check for required tools
try {
  execSync('xcrun notarytool --version', { stdio: 'ignore' });
  console.log('✅ Found xcrun notarytool');
} catch (e) {
  console.error('❌ xcrun notarytool not found. Please ensure Xcode Command Line Tools are installed.');
  process.exit(1);
}

// 2. Check environment variables
const missing = [];
if (!credentials.appleId) missing.push('APPLE_ID');
if (!credentials.password) missing.push('APPLE_APP_SPECIFIC_PASSWORD');
if (missing.length > 0) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
  console.log('📝 Please set these in packages/xgenia-editor/.env');
  process.exit(1);
}
console.log(`✅ Credentials present for: ${credentials.appleId}`);

// 3. Verify appId consistency
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const appId = pkg.build.appId;
  console.log(`ℹ️  Current appId in package.json: ${appId}`);

  // Check if it matches hardcoded appId in macos-notarize.js (optional but helpful)
  const notarizeScriptPath = path.join(__dirname, 'macos-notarize.js');
  if (fs.existsSync(notarizeScriptPath)) {
    const notarizeScript = fs.readFileSync(notarizeScriptPath, 'utf8');
    if (notarizeScript.includes(`const appId = '${appId}'`)) {
      console.log('✅ appId matches in macos-notarize.js');
    } else if (notarizeScript.includes('params.packager.appInfo.id')) {
        console.log('✅ macos-notarize.js uses dynamic appId (Robust)');
    } else {
      console.warn('⚠️  appId might be out of sync in macos-notarize.js');
    }
  }
} catch (e) {
  console.warn('⚠️  Could not verify appId consistency:', e.message);
}

// 4. Test communication with Apple
console.log('📡 Testing communication with Apple servers (notarytool history)...');
try {
  const teamFlag = credentials.teamId ? `--team-id "${credentials.teamId}"` : '';
  const cmd = `xcrun notarytool history --apple-id "${credentials.appleId}" --password "${credentials.password}" ${teamFlag}`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('\n✅ SUCCESS: Apple\'s servers are responding and credentials are valid!');
} catch (error) {
  console.error('\n❌ FAILED: Verification failed. Possible causes:');
  console.error('  - Incorrect Apple ID or App-Specific Password');
  console.error('  - Incorrect Team ID');
  console.error('  - Network issues reaching Apple servers');
  process.exit(1);
}