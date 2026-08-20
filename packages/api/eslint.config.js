import { configApp, RULES_LIST } from '@adonisjs/eslint-config'

export default [
  { ignores: ['database/schema.ts'] },
  ...configApp({
    files: ['app/**/*.tsx'],
    name: 'React email templates',
    rules: RULES_LIST,
  }),
]
