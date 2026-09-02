Corrige `windowsOverlap` dans `src/scheduling.ts`.

Les fenêtres représentent des intervalles semi-ouverts `[start, end)`. Deux fenêtres seulement adjacentes ne se chevauchent donc pas. Une fenêtre vide ou inversée (`start >= end`) est invalide et ne chevauche rien. Préserve les exports publics et ne modifie aucun autre fichier. Exécute le build avant de terminer.
