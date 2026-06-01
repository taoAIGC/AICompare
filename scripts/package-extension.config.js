module.exports = {
  defaultEntries: [
    'manifest.json',
    'background.js',
    '_locales',
    'config',
    'contact',
    'content-scripts',
    'docs/release-notes',
    'favorites',
    'firebase',
    'history',
    'homepage',
    'icons',
    'iframe',
    'options',
    'remote',
    'shared',
    'siteIcons',
    'vendor'
  ],
  optionalEntries: {
    debug: ['debug']
  },
  excludePatterns: ['*.DS_Store', '__MACOSX/*']
};
