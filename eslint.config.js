import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.cache/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', location: 'readonly', history: 'readonly', fetch: 'readonly', console: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', alert: 'readonly', confirm: 'readonly', URL: 'readonly', Blob: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLSelectElement: 'readonly', Event: 'readonly', Response: 'readonly', Request: 'readonly', crypto: 'readonly' } } }
);
