// Runs against the built CommonJS bundle: Jest executes CJS, so this checks what Jest users really load.
const common = { rootDir: __dirname, transform: {}, testEnvironment: 'node' };

module.exports = {
  projects: [
    { ...common, displayName: 'globals', testMatch: ['**/globals.test.cjs'] },
    {
      ...common,
      displayName: 'no-globals',
      injectGlobals: false,
      testMatch: ['**/explicit.test.cjs'],
    },
  ],
};
