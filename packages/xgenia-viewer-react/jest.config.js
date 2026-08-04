/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    // The node modules in src/ are ESM/JSX — babel (babel.config.js) is what
    // webpack uses for them, so tests load them the same way.
    '^.+\\.jsx?$': 'babel-jest'
  },
  moduleNameMapper: {
    '\\.(css|less|scss)$': '<rootDir>/tests/style-mock.js'
  }
};
