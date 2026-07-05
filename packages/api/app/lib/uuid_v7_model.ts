import { uuidV7 } from '#lib/uuid_v7'

type ModelWithId = {
  id?: string | null
}

export function assignUuidV7Id(model: ModelWithId) {
  if (!model.id) model.id = uuidV7()
}
