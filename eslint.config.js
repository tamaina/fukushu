import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['packages/app/src/**/*.{ts,vue}', 'packages/app/tests/**/*.ts'],
    languageOptions: {
      globals: {
        Blob: 'readonly',
        crypto: 'readonly',
        document: 'readonly',
        DragEvent: 'readonly',
        File: 'readonly',
        location: 'readonly',
        sessionStorage: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        confirm: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  { files: ['**/*.ts', '**/*.vue'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    // Prettier owns layout; these stylistic rules otherwise report the same markup differently.
    rules: {
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/no-v-html': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
)
