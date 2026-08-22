const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Allow importing the shared @nexora/core package from the monorepo root.
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../packages/core/node_modules'),
];
config.resolver.extraNodeModules = {
  '@nexora/core': path.resolve(__dirname, '../packages/core/src'),
};

module.exports = config;
