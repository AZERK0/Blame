import PreviewWorkspaceArtifact from '#models/preview_workspace_artifact'
import { test } from '@japa/runner'

test.group('preview workspace artifact', () => {
  test('maps the checksum property to the migrated sha256 column', ({ assert }) => {
    assert.equal(
      PreviewWorkspaceArtifact.$columnsDefinitions.get('sha256')?.columnName,
      'sha256'
    )
  })
})
