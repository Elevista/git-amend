module.exports = {
  root: true,
  extends: [
    'standard'
  ],
  overrides: [{ files: ['*.js'] }],
  rules: {
    'no-restricted-globals': ['error', 'name'],
    'prefer-const': 'error',
    'no-var': 'error',
    'prefer-template': 'error',
    'standard/array-bracket-even-spacing': ['error', 'never']
  }
}
