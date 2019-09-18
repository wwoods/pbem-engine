const packageJson = require('./package.json');
module.exports = {
  chainWebpack(config) {
    config
      .plugin('html')
      .tap((args) => {
        args[0].title = packageJson.description;
        args[0].meta = {
          viewport: 'width=device-width, initial-scale=1, user-scalable=no',
        };
        return args;
      });
  },
  pwa: {
    name: packageJson.description,
    workboxPluginMode: 'InjectManifest',
    workboxOptions: {
      swSrc: './src/serviceWorkerInject.js',
      swDest: 'service-worker.js',
    },
  },
};

