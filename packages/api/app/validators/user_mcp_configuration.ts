import vine from '@vinejs/vine'

export const saveUserMcpConfigurationValidator = vine.create({
  servers: vine
    .array(
      vine.object({
        command: vine.string().trim().minLength(1).maxLength(500).optional(),
        disabled: vine.boolean(),
        name: vine.string().trim().minLength(1).maxLength(80),
        transport: vine.enum(['stdio', 'streamableHttp', 'sse']),
        url: vine
          .string()
          .trim()
          .url({ protocols: ['http', 'https'] })
          .maxLength(2048)
          .optional(),
      })
    )
    .maxLength(100),
})
