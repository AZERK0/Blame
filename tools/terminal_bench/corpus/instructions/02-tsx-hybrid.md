Dans `src/ProjectCard.tsx`, importe `ProjectBadge` depuis `./ProjectBadge`, puis remplace le corps du composant exporté `ProjectCard` afin d'afficher `<ProjectBadge />` immédiatement avant le titre existant.

Préserve le type des props, le texte du titre et l'attribut `data-artist`. Regroupe l'import et le remplacement symbolique dans un même batch atomique si le harness le permet. Exécute ensuite le build et ne modifie aucun autre fichier.
