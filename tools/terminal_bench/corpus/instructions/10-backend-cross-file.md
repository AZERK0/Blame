Prépare l'API projets pour la publication.

Dans `prisma/schema.prisma`, ajoute au modèle `Project` un champ `slug String @unique`, un champ `published Boolean @default(false)` et un index sur `[published, createdAt]`.

Dans `src/api/projects.ts`, étends `ProjectRecord` avec `slug` et `published`, puis fais retourner ces deux champs par `serializeProject`. Préserve les champs existants. Exécute le build et ne modifie aucun autre fichier.
