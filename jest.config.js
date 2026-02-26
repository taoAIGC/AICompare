module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'config/baseConfig.js',
    'config/siteDetector.js',
    'iframe/inject.js',
  ],
  coverageDirectory: 'coverage',
  setupFiles: ['./tests/setup.js'],
};
