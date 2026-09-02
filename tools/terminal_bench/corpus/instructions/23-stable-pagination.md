Corrige `paginatePublishedProjects` dans `src/pagination.ts`.

La fonction filtre les projets publiés, les trie par `createdAt` décroissant puis par `id` croissant en cas d'égalité, et applique ensuite une pagination commençant à la page 1. Une page ou une taille non entière ou inférieure à 1 renvoie un tableau vide. Le tableau et les objets reçus ne doivent jamais être mutés. Préserve l'API publique, ne modifie aucun autre fichier et exécute le build.
