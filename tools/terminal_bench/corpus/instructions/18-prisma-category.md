Ajoute une catégorisation optionnelle des projets dans `prisma/schema.prisma` et `src/api/projects.ts`.

Crée un modèle `ProjectCategory` avec `id`, `name`, un `slug` unique et la relation inverse vers les projets. Ajoute à `Project` une relation optionnelle et sa clé étrangère optionnelle, avec un index sur cette clé. Dans l'API, représente la catégorie chargée par `{ slug: string } | null` et expose `categorySlug` avec le slug ou `null` dans `serializeProject`. Ne modifie aucun autre fichier et valide avec le build.
