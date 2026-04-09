module.exports = {
  type: 'dev',
  enableAutoUpdate: false,
  Tracker: {
    trackExceptions: false
  },
  PreviewServer: {
    port: 8575
  },
  devMode: true,

  apiEndpoint: 'https://apidev.xgeniacloud.com',
  domainEndpoint: 'http://domains.xgeniacloud.com',
  aiEndpoint: 'https://ftii7qa6g2a3k3hlwi6etoo3z40qbbtw.lambda-url.us-east-1.on.aws',

  // Test config during dev
  //  userConfig: require('./userconfig-dev')
};
