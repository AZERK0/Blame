import { uuidV7 } from '#lib/uuid_v7'
import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

type UserReference = {
  table: string
  column: string
  constraint: string
  uuidColumn: string
  primary?: boolean
  indexes?: { name: string; columns: string[]; unique?: boolean }[]
}

const userReferences: UserReference[] = [
  {
    table: 'auth_access_tokens',
    column: 'tokenable_id',
    constraint: 'auth_access_tokens_tokenable_id_foreign',
    uuidColumn: 'uuid_tokenable_id',
  },
  {
    table: 'projects',
    column: 'user_id',
    constraint: 'projects_user_id_foreign',
    uuidColumn: 'uuid_user_id',
    indexes: [
      {
        name: 'projects_user_id_repository_fingerprint_unique',
        columns: ['user_id', 'repository_fingerprint'],
        unique: true,
      },
      { name: 'projects_user_id_index', columns: ['user_id'] },
    ],
  },
  {
    table: 'provider_credentials',
    column: 'user_id',
    constraint: 'provider_credentials_user_id_foreign',
    uuidColumn: 'uuid_user_id',
    indexes: [
      {
        name: 'provider_credentials_user_id_provider_id_label_unique',
        columns: ['user_id', 'provider_id', 'label'],
        unique: true,
      },
      {
        name: 'provider_credentials_user_id_provider_id_index',
        columns: ['user_id', 'provider_id'],
      },
    ],
  },
  {
    table: 'user_ai_preferences',
    column: 'user_id',
    constraint: 'user_ai_preferences_user_id_foreign',
    uuidColumn: 'uuid_user_id',
    primary: true,
  },
]

export default class extends BaseSchema {
  static disableTransactions = true

  async up() {
    this.defer(async (db) => {
      if (!(await needsUserIdConversion(db))) return
      await convertUserIds(db)
    })
  }

  async down() {}
}

async function needsUserIdConversion(db: QueryClientContract) {
  if (await hasColumn(db, 'users', 'uuid_id')) return true
  if (await isNumericColumn(db, 'users', 'id')) return true
  const references = await existingReferences(db)
  for (const reference of references) {
    if (await hasColumn(db, reference.table, reference.uuidColumn)) return true
    if (await isNumericColumn(db, reference.table, reference.column)) return true
  }
  return false
}

async function convertUserIds(db: QueryClientContract) {
  const references = await existingReferences(db)
  await db.rawQuery('SET FOREIGN_KEY_CHECKS=0')
  try {
    await dropForeignKeys(db, references)
    await addUuidColumns(db, references)
    await assignUuidUserIds(db)
    await copyUuidReferences(db, references)
    await replaceUsersId(db)
    await replaceReferenceIds(db, references)
  } finally {
    await db.rawQuery('SET FOREIGN_KEY_CHECKS=1')
  }
}

async function existingReferences(db: QueryClientContract) {
  const tables = await db.getAllTables()
  return userReferences.filter((reference) => tables.includes(reference.table))
}

async function dropForeignKeys(db: QueryClientContract, references: UserReference[]) {
  for (const reference of references) {
    if (await foreignKeyExists(db, reference)) {
      await db.rawQuery(`ALTER TABLE ${reference.table} DROP FOREIGN KEY ${reference.constraint}`)
    }
  }
}

async function addUuidColumns(db: QueryClientContract, references: UserReference[]) {
  if ((await isNumericColumn(db, 'users', 'id')) && !(await hasColumn(db, 'users', 'uuid_id'))) {
    await db.rawQuery('ALTER TABLE users ADD COLUMN uuid_id CHAR(36) NULL')
  }
  for (const reference of references) {
    await addReferenceUuidColumn(db, reference)
  }
}

async function assignUuidUserIds(db: QueryClientContract) {
  if (!(await hasColumn(db, 'users', 'uuid_id'))) return
  const users = (await db.from('users').select('id').whereNull('uuid_id')) as { id: number }[]
  for (const user of users) {
    await db.from('users').where('id', user.id).update({ uuid_id: uuidV7() })
  }
}

async function copyUuidReferences(db: QueryClientContract, references: UserReference[]) {
  if (!(await hasColumn(db, 'users', 'uuid_id'))) return
  for (const reference of references) {
    if (!(await hasColumn(db, reference.table, reference.uuidColumn))) continue
    await db.rawQuery(
      `UPDATE ${reference.table} JOIN users ON ${reference.table}.${reference.column} = users.id SET ${reference.table}.${reference.uuidColumn} = users.uuid_id`
    )
  }
}

async function replaceUsersId(db: QueryClientContract) {
  if (!(await isNumericColumn(db, 'users', 'id'))) return
  await db.rawQuery('ALTER TABLE users MODIFY id INT UNSIGNED NOT NULL, DROP PRIMARY KEY')
  await db.rawQuery(
    'ALTER TABLE users DROP COLUMN id, CHANGE uuid_id id CHAR(36) NOT NULL, ADD PRIMARY KEY (id)'
  )
}

async function replaceReferenceIds(db: QueryClientContract, references: UserReference[]) {
  for (const reference of references) {
    await replaceReferenceId(db, reference)
    await createReferenceIndexes(db, reference)
    await createForeignKey(db, reference)
  }
}

async function addReferenceUuidColumn(db: QueryClientContract, reference: UserReference) {
  if (!(await isNumericColumn(db, reference.table, reference.column))) return
  if (await hasColumn(db, reference.table, reference.uuidColumn)) return
  await db.rawQuery(
    `ALTER TABLE ${reference.table} ADD COLUMN ${reference.uuidColumn} CHAR(36) NULL`
  )
}

async function replaceReferenceId(db: QueryClientContract, reference: UserReference) {
  if (!(await isNumericColumn(db, reference.table, reference.column))) return
  await dropReferenceIndexes(db, reference)
  await db.rawQuery(
    `ALTER TABLE ${reference.table} DROP COLUMN ${reference.column}, CHANGE ${reference.uuidColumn} ${reference.column} CHAR(36) NOT NULL`
  )
}

async function dropReferenceIndexes(db: QueryClientContract, reference: UserReference) {
  if (reference.primary && (await isPrimaryKey(db, reference))) {
    await db.rawQuery(`ALTER TABLE ${reference.table} DROP PRIMARY KEY`)
  }
  for (const index of reference.indexes ?? []) {
    if (await indexExists(db, reference.table, index.name)) {
      await db.rawQuery(`ALTER TABLE ${reference.table} DROP INDEX ${index.name}`)
    }
  }
}

async function createReferenceIndexes(db: QueryClientContract, reference: UserReference) {
  if (reference.primary && !(await isPrimaryKey(db, reference))) {
    await db.rawQuery(`ALTER TABLE ${reference.table} ADD PRIMARY KEY (${reference.column})`)
  }
  for (const index of reference.indexes ?? []) {
    if (await indexExists(db, reference.table, index.name)) continue
    const kind = index.unique ? 'UNIQUE' : 'INDEX'
    await db.rawQuery(
      `ALTER TABLE ${reference.table} ADD ${kind} ${index.name} (${index.columns.join(', ')})`
    )
  }
}

async function createForeignKey(db: QueryClientContract, reference: UserReference) {
  if (await foreignKeyExists(db, reference)) return
  await db.rawQuery(
    `ALTER TABLE ${reference.table} ADD CONSTRAINT ${reference.constraint} FOREIGN KEY (${reference.column}) REFERENCES users(id) ON DELETE CASCADE`
  )
}

async function hasColumn(db: QueryClientContract, table: string, column: string) {
  const columns = await db.columnsInfo(table)
  return Boolean(columns[column])
}

async function isNumericColumn(db: QueryClientContract, table: string, column: string) {
  const columns = await db.columnsInfo(table)
  return columns[column]?.type.toLowerCase().includes('int') ?? false
}

async function isPrimaryKey(db: QueryClientContract, reference: UserReference) {
  const primaryKeys = await db.getPrimaryKeys(reference.table)
  return primaryKeys.length === 1 && primaryKeys[0] === reference.column
}

async function indexExists(db: QueryClientContract, table: string, index: string) {
  const row = await db
    .knexQuery()
    .from('information_schema.statistics')
    .whereRaw('table_schema = database()')
    .where('table_name', table)
    .where('index_name', index)
    .first()
  return Boolean(row)
}

async function foreignKeyExists(db: QueryClientContract, reference: UserReference) {
  const row = await db
    .knexQuery()
    .from('information_schema.key_column_usage')
    .whereRaw('constraint_schema = database()')
    .where('table_name', reference.table)
    .where('constraint_name', reference.constraint)
    .where('column_name', reference.column)
    .first()
  return Boolean(row)
}
