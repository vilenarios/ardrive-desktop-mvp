module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node', // Changed from jsdom since we're testing main process
  
  // Define module paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': 'jest-transform-stub',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  
  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{ts,tsx}'
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main/main.ts', // Skip electron main entry point
    '!src/main/preload.ts', // Skip preload script
    '!src/renderer/index.tsx', // Skip renderer entry point
    '!src/**/__tests__/**',
    '!src/**/test/**',
  ],
  
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  

  // Test environment configuration
  testEnvironmentOptions: {
    url: 'http://localhost',
  },
  
  // Ignore patterns for transforming node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(ardrive-core-js|@ardrive/turbo-sdk)/)'
  ],
};