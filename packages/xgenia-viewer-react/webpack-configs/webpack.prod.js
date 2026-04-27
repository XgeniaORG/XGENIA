const viewer = require('./webpack.viewer.prod');
const deploy = require('./webpack.deploy.prod');
// Temporarily skip the ssr build as it's still having issues
// const ssr = require('./webpack.ssr.prod');

module.exports = [viewer, deploy];
