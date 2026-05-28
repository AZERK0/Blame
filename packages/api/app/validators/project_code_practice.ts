import vine from '@vinejs/vine'

export const projectCodePractice = vine.enum([
  'coding_style',
  'unit_tests',
  'layered_architecture',
  'commit_message_convention',
])

export const updateProjectCodePracticeValidator = vine.create({
  enabled: vine.boolean(),
})
