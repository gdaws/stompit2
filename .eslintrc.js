module.exports = {
  parser: '@typescript-eslint/parser', // Specifies the ESLint parser
  parserOptions: {
    ecmaVersion: 2020, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module' // Allows for the use of imports
  },
  extends: [
    'plugin:@typescript-eslint/recommended' // Uses the recommended rules from the @typescript-eslint/eslint-plugin
  ],
  rules: {
    // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
    // e.g. "@typescript-eslint/explicit-function-return-type": "off",
    'linebreak-style': ['error', 'unix'],
    'brace-style': ['error', 'stroustrup'],
    'quotes': ['error', 'single'],
    'indent': ['error', 2],
    'object-curly-spacing': ['error', 'always'],
    'no-trailing-spaces': ['error'],
    'padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: ['function', 'class', 'if', 'do', 'for', 'while', 'switch', 'try'], next: '*' }
    ],
    'padded-blocks': ['error', 'never']
  }
};
