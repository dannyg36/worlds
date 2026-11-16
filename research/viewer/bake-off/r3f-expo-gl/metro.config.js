const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const threeModule = path.resolve(__dirname, 'node_modules/three/build/three.module.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
