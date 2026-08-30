# ADR-001 — Autorités du Harness Core

**Statut : accepté — 29 août 2026**

## Décision

Le Harness Core sépare quatre autorités : `ConversationAuthority`, `EffectAuthority`, `EvidenceAuthority` et `ExecutionAuthority`. Une autorité possède les faits de son domaine ; elle ne délègue pas leur vérité à une projection de contexte, au frontend ou à l’adaptateur Cline.

Les vues de contexte sont des projections révisionnées et liées à un epoch. Elles peuvent être supprimées, invalidées et reconstruites depuis les autorités sans modifier celles-ci. La source revision est observée par un port distinct et accompagne tout fait dépendant du code.

## Conséquences

- Le package `@blame/harness-core` ne dépend ni de Cline, ni d’Electron, ni du frontend.
- Les adaptateurs négocient transport, streaming, annulation et compaction par manifeste.
- Les lecteurs historiques peuvent projeter v2, mais le résultat v3 reste l’unique résultat de domaine produit sur le chemin nominal.
- Les caches, capsules et briefings ne deviennent jamais des autorités implicites.

## État d’implémentation

Le Core fournit les contrats et les implémentations de référence des quatre autorités. Leur migration de production reste partielle : l’adaptateur v3 utilise actuellement une `EvidenceAuthority` en mémoire, tandis que la conversation, les effets et l’exécution restent majoritairement portés par les stores et services historiques du runtime. Ces composants ne doivent donc pas encore être présentés comme un writer Core unique.
