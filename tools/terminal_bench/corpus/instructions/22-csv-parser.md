Corrige `parseCsvRow` dans `src/csv.ts` sans dépendance externe.

Le parseur doit gérer les virgules dans un champ entre guillemets, les guillemets échappés par `""`, les champs vides et la virgule finale. Les champs non quotés sont trimés ; les espaces contenus dans un champ cité sont préservés. L'entrée représente toujours une seule ligne CSV bien formée. Préserve l'export, ne modifie aucun autre fichier et valide le build.
