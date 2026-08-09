# Runtime de preview cloud — spécification finale

**Statut :** décision d’architecture normative
**Portée :** preview cloud Blame
**Moteur cloud unique :** Vercel Sandbox avec Docker Compose

## 1. Décision

Chaque story cloud dispose d’une microVM Vercel Sandbox persistante. Vercel fournit uniquement la Sandbox et son ingress. Le backend Blame, l’application, la vitrine, Preview Edge, le stockage des artefacts et les téléchargements restent sur l’infrastructure OVH de Blame.

Le projet utilisateur s’exécute exclusivement comme un projet Docker Compose compilé depuis le `PreviewManifest` canonique. Aucun moteur alternatif par processus natifs n’est exposé par le contrat, l’API, le runner ou l’interface.

Le profil public cloud unique est `vercel-compose`. L’interface l’affiche comme « Vercel Sandbox » ou « Cloud preview » sans demander à l’utilisateur de choisir un moteur.

## 2. Matrice hôte

| Mode              | Linux                          | macOS                          | Windows                          | Exécution du projet                |
| ----------------- | ------------------------------ | ------------------------------ | -------------------------------- | ---------------------------------- |
| `local-container` | runtime Linux local            | Lima                           | WSL2                             | conteneurs locaux                  |
| `vercel-compose`  | worktree et agent natifs Linux | worktree et agent natifs macOS | worktree et agent natifs Windows | Docker Compose dans Vercel Sandbox |

Une preview cloud ne démarre ni Lima ni WSL2. Le worktree, Git, l’agent et la synchronisation restent natifs sur l’OS hôte. Seuls les artefacts nécessaires à la story sont transférés vers la Sandbox après consentement explicite.

## 3. Image Sandbox Blame

La Sandbox démarre directement depuis une image OCI Blame personnalisée, stockée dans VCR et référencée par digest :

```text
registry/repository@sha256:<digest>
```

Le backend refuse une image non épinglée. L’image contient avant son publication :

- Docker Engine et ses composants d’exécution ;
- Docker Compose ;
- BuildKit ;
- `blame-sandbox-runner` et `blame-runnerctl` ;
- le gateway HTTP Blame ;
- les certificats nécessaires au proxy Vercel ;
- Node, Git et les outils système minimaux de diagnostic et de supervision.

Le boot normal ne télécharge aucun binaire et n’installe aucun paquet système. Les commandes d’installation présentes dans le Dockerfile de l’image s’exécutent uniquement lors de sa construction contrôlée, avec versions et empreintes vérifiées.

Le protocole API/runner reste versionné indépendamment du manifeste. Au handshake, le backend vérifie :

- la version du protocole ;
- la version du runner ;
- le digest de l’image attendue ;
- les capabilities Compose, ingress, snapshot et réseau.

Une incompatibilité interdit l’exécution et force la recréation de la session.

## 4. Manifeste canonique

Le `PreviewManifest` est strict, non versionné et exclusivement orienté conteneurs. Il est la seule source de vérité. `docker-compose.yml` et le script de setup sont des artefacts déterministes générés et remplaçables.

Chaque setup task et chaque service contient exactement un objet `container` avec exactement une source :

```json
{ "container": { "image": "node:24@sha256:<digest>" } }
```

ou :

```json
{
  "container": {
    "build": {
      "context": "apps/api",
      "dockerfile": "Dockerfile",
      "target": "development"
    }
  }
}
```

Le schéma n’accepte aucun champ de version de manifeste, aucune source d’exécution historique et aucun fallback. Toute clé inconnue est refusée au niveau où elle apparaît.

### 4.1 Exemple complet minimal

```json
{
  "confidence": "high",
  "project": { "root": ".", "detectedStack": ["node"] },
  "setup": [
    {
      "id": "deps",
      "container": { "image": "node:24@sha256:<digest>" },
      "workingDir": "/workspace",
      "command": "corepack pnpm install"
    }
  ],
  "services": [
    {
      "id": "api",
      "kind": "worker",
      "container": {
        "build": { "context": "apps/api", "dockerfile": "Dockerfile" }
      },
      "workingDir": "/workspace/apps/api",
      "command": "corepack pnpm dev",
      "endpoints": [
        {
          "id": "http",
          "protocol": "http",
          "port": 3333,
          "healthcheck": {
            "type": "http",
            "path": "/health",
            "timeoutMs": 30000
          }
        }
      ]
    },
    {
      "id": "app",
      "kind": "preview",
      "container": { "image": "node:24@sha256:<digest>" },
      "workingDir": "/workspace/apps/app",
      "command": "corepack pnpm dev",
      "dependsOn": ["api"],
      "endpoints": [
        {
          "id": "http",
          "protocol": "http",
          "port": 3000,
          "healthcheck": { "type": "http", "path": "/", "timeoutMs": 30000 }
        }
      ],
      "bindings": [
        {
          "target": { "type": "environment", "key": "API_URL" },
          "source": { "service": "api", "endpoint": "http" },
          "exposure": "server",
          "format": "url"
        }
      ]
    },
    {
      "id": "vitrine",
      "kind": "preview",
      "container": { "image": "node:24@sha256:<digest>" },
      "workingDir": "/workspace/apps/vitrine",
      "command": "corepack pnpm dev",
      "endpoints": [
        {
          "id": "http",
          "protocol": "http",
          "port": 3001,
          "healthcheck": { "type": "http", "path": "/", "timeoutMs": 30000 }
        }
      ]
    }
  ],
  "caches": [],
  "risks": [],
  "probes": []
}
```

Les trois endpoints `api:http`, `app:http` et `vitrine:http` sont distincts et valides.

### 4.2 Contraintes de compilation

Le compilateur représente :

- image ou build Docker contrôlé ;
- `command`, `entrypoint`, `workingDir` et utilisateur non-root ;
- variables non secrètes et bindings typés ;
- `dependsOn`, healthchecks et probes bornés ;
- endpoints HTTP, HTTPS et TCP ;
- caches et volumes nommés ;
- DNS interservices Compose ;
- commandes de stop, reprise, inspection et logs par service.

Les contextes et Dockerfiles sont des chemins relatifs contrôlés dans `/workspace`. Les builds distants, arguments secrets, contextes additionnels, accès SSH et sorties de cache externes ne font pas partie du contrat.

## 5. Identité des endpoints et routes

Un endpoint est identifié par :

```text
(serviceId, endpointId)
```

`endpointId` est unique uniquement dans son service. La clé structurée interne est `serviceId:endpointId`.

Chaque listener gateway possède cette identité et un `routeId` opaque. Le calcul du `routeId` inclut au minimum :

```text
sessionId + NUL + serviceId + NUL + endpointId
```

Le `routeId` est stable entre les générations d’une même session. La génération reste une claim séparée afin qu’une capability d’une génération précédente ne soit jamais acceptée après reprise.

`EndpointMap` expose `primaryRouteId`; il n’expose aucune identité primaire basée sur le seul endpoint local. Les tickets, cookies Preview Edge, bridge grants Electron et capabilities gateway contiennent tous `routeId`, `serviceId` et `endpointId`.

La base SQL applique l’unicité :

```text
UNIQUE(session_id, service_id, endpoint_id)
```

Les tickets stockent également `route_id` et `service_id`. Les anciennes routes et anciens tickets, entièrement dérivés, sont supprimés pendant la migration de contrainte puis recréés.

## 6. Sélection des services

Une run configuration `web` ou `service` déclare au moins un service racine. Une configuration native `desktop`, `mobile`, `terminal` ou `other` peut déclarer `services: []` lorsqu’aucun équivalent conteneur fidèle n’existe.

Le runner calcule la fermeture transitive des dépendances des services sélectionnés. Pour « Web application » sélectionnant `app`, le démarrage inclut `app`, `api` et les dépendances réelles d’`api`, mais pas `vitrine` si elle est indépendante.

Compose démarre en parallèle les services indépendants. Les collisions de ports logiques ne sont vérifiées que dans l’ensemble effectivement sélectionné. Deux services jamais démarrés ensemble peuvent utiliser le même port logique.

## 7. Réseau et sécurité Compose

Le projet utilise un réseau Compose standard. Le mode réseau hôte global est interdit.

Les services sont durcis avec :

- utilisateur projet non-root par défaut ;
- `cap_drop: [ALL]` ;
- `no-new-privileges` ;
- limites de processus et de fichiers ;
- volumes nommés contrôlés ;
- bind mount direct du workspace ;
- montage `.git` en lecture seule lorsque requis ;
- certificat proxy en lecture seule lorsque présent.

Le socket Docker privé du runner est `/run/blame/docker.sock`. Il n’est jamais monté dans un service projet. Sont aussi interdits : `privileged`, PID/IPC hôte, devices, capabilities dangereuses, montages absolus hôte et montage de la racine.

Le DNS Compose est le mécanisme normal d’adressage interservices. Lorsqu’un serveur exige réellement `localhost`, le compilateur crée uniquement un groupe loopback ciblé via `network_mode: service:<ancre>`. Les groupes qui se chevauchent ou les collisions réelles sont refusés ; le code utilisateur n’est jamais réécrit.

L’egress Vercel est limité à la liste contrôlée de registries, sources de dépendances et endpoints OVH nécessaires aux artefacts.

## 8. Secrets

Le manifeste, le Compose, les logs et les snapshots ne contiennent aucun secret littéral. Le parser refuse les clés d’environnement à caractère secret, les clés privées, les credentials intégrés dans une URL et les commandes dangereuses.

Tant qu’un credential broker explicite n’est pas disponible, un plan nécessitant un secret runtime est déclaré incompatible. Les URL signées et URL portant des credentials sont refusées par l’état persistant du runner. Les logs applicatifs passent par une redaction bornée avant exposition.

## 9. Cycle de vie

### 9.1 Création

1. Le backend compile et valide le manifeste.
2. Il calcule les ports gateway et crée ou récupère une Sandbox persistante depuis l’image épinglée.
3. Il applique ressources, timeout, snapshot retention et network policy.
4. Le bootstrap initialise uniquement les identités et répertoires déjà présents dans l’image, puis démarre le watcher du journal workspace.
5. Le backend vérifie le handshake.
6. Le workspace est synchronisé une fois.
7. Le runner génère le Compose, démarre `dockerd`, attend `docker info`, crée les caches et exécute le setup.
8. Le runner pull/build uniquement les services sélectionnés et démarre leur fermeture de dépendances.
9. Les healthchecks et probes bornés déterminent la readiness.
10. Preview Edge publie les routes et Electron ouvre la route primaire via son bridge sécurisé.

### 9.2 Arrêt et destruction

Le runner arrête d’abord le gateway, puis exécute `docker compose down --remove-orphans --timeout 15`. Compose envoie le signal d’arrêt avant tout SIGKILL. La destruction révoque routes et tickets puis supprime la Sandbox. Aucun conteneur ni réseau orphelin ne doit subsister.

### 9.3 Suspension et reprise

Avant suspension, Blame exporte un delta durable, révoque les routes actives et snapshotte la Sandbox. `/var/lib/blame/docker` reste sous le filesystem persistant afin de conserver images, volumes et caches BuildKit lorsque Vercel garantit leur compatibilité.

À la reprise :

1. Vercel reprend la Sandbox et incrémente la génération ;
2. le bootstrap vérifie les identités et le watcher ;
3. le runner conserve le plan Compose canonique mais remet l’état d’exécution à `stopped` ;
4. une version de plan d’exécution incompatible provoque `STALE_EXECUTION_PLAN` et la recréation de la session ;
5. les routes sont republiées avec le même `routeId` et la nouvelle génération ;
6. les anciennes capabilities sont invalides ;
7. les services sélectionnés sont relancés et reprobés.

## 10. Caches et performance

La performance ne change pas la fidélité du runtime :

- Docker, Compose et BuildKit sont préinstallés ;
- `/var/lib/blame/docker` conserve images, layers, volumes et cache BuildKit ;
- les volumes nommés conservent les stores pnpm, npm, yarn, bun, pip et Cargo ;
- le workspace est synchronisé une fois puis bind-monté directement ;
- les pulls utilisent la politique `missing` et réutilisent les layers persistés ;
- les builds sont limités aux services sélectionnés et à leurs dépendances ;
- les services indépendants sont lancés par un seul `compose up` ;
- le bootstrap lance `dockerd` sans attendre sa readiness afin de recouvrir son
  initialisation avec l’import source et le handshake ;
- un fingerprint du Compose rendu évite de réécrire sa configuration et de
  recréer ses volumes lorsqu’ils correspondent déjà exactement ;
- un seul snapshot du workspace alimente les fingerprints de setup et d’images
  pendant un démarrage ;
- les fenêtres de healthcheck sont bornées ;
- les logs sont paginés par curseur et bornés ;
- les arrêts sont gracieux et suppriment les orphelins.

Les images communes ne sont préchargées dans l’image Sandbox qu’après mesure d’un gain supérieur à leur coût de stockage et de transfert.

## 11. Mesures structurées

Le backend enregistre des métriques OTel `blame.runtime.phase.count` et `blame.runtime.phase.duration` avec seulement le nom du runtime, la phase et le statut. Le runner écrit des événements JSON privés dans `/var/log/blame/runtime-performance.jsonl` avec timestamp, phase, statut et durée.

Phases obligatoires :

- `sandbox.create` ;
- `workspace.sync` ;
- `dockerd.start` ;
- `compose.prepare` ;
- `compose.prepare.cached` ;
- `compose.pull` ;
- `compose.build` ;
- `dependencies.install` ;
- `services.start` ;
- `preview.readiness`.

Aucune commande, URL, variable, exception brute, clé, token ou identifiant signé n’est attaché à ces mesures.

## 12. Données et migration destructive

La migration canonique supprime uniquement les lignes historiques de `project_initializations`. Elle ne touche pas aux projets, stories, conversations, pièces jointes ni préférences de pratiques de code. Sa migration descendante est volontairement vide : les données supprimées ne sont pas reconstructibles.

À la préparation suivante d’une story, Blame régénère et écrase `.blame/initialization` depuis le nouveau manifeste.

## 13. Génération agent

Le JSON Schema de `submit_project_initialization` et ses prompts imposent :

- un manifeste non versionné ;
- exactement une source `container.image` ou `container.build` par setup/service ;
- des chemins de build relatifs contrôlés ;
- des endpoints réutilisables entre services ;
- des bindings et probes identifiés par service et endpoint ;
- des configurations `web` et `service` non vides ;
- des surfaces natives host-only autorisées avec `services: []` ;
- l’interdiction de lire ou générer un secret réel.

## 14. Validation attendue

La livraison vérifie au minimum :

- acceptation exclusive du manifeste canonique image/build ;
- refus explicite des champs historiques ;
- coexistence de `api:http`, `app:http` et `vitrine:http` ;
- route primaire opaque non ambiguë ;
- bindings/probes et auth gateway scellés par service + endpoint ;
- sélection exacte des services et dépendances ;
- refus des topologies dangereuses, du socket Docker et des secrets persistés ;
- refus API explicite de tout ancien profil cloud ;
- absence de sélection de moteur dans l’interface ;
- reprise de Sandbox, rotation de génération et refus d’un plan périmé ;
- validité des routes Preview Edge après republication ;
- portée exacte de la migration destructive ;
- worktree cloud natif sur Linux, macOS et Windows ;
- build et inspection du Dockerfile runner ;
- canary Vercel réel uniquement lorsque les credentials nécessaires sont déjà disponibles.

## 15. Baselines immuables et démarrage rapide

Le chemin rapide de création est basé sur une baseline de projet, indexée par un fingerprint SHA-256 canonique :

`projectId + baseRevision + sanitizedTreeHash + planHash + lockfileHash + runnerImageDigest + runnerVersion + protocolVersion + cachePolicyVersion`.

Une baseline est une ligne `preview_project_baselines` et un snapshot Vercel Sandbox. Le snapshot est construit dans une Sandbox persistante dédiée, avec l’image runner épinglée par digest. Le runner importe le bundle Git nettoyé, prépare Compose, installe les dépendances, pull/build les images nécessaires, puis arrête Compose, dockerd, le gateway, les exports et les journaux avant `snapshot()`.

Les URL de bindings du warm-up sont des placeholders non signés (`baseline.invalid`). Aucune URL Preview Edge, capability, clé publique, requête de contrôle ou delta ne peut donc entrer dans la baseline. La source, les fichiers `.env`, credentials, journaux et métadonnées Git sensibles restent exclus par les validateurs existants.

À l’attachement d’un worktree, le desktop calcule et envoie les métadonnées de source avant la création provider. L’API sélectionne alors la baseline et provisionne directement la Sandbox US depuis son snapshot ; elle ne crée pas une Sandbox vide destinée à être immédiatement remplacée. En cas de hit, le desktop transfère un delta gzip limité aux chemins `files/*` ; sinon il transfère l’archive complète. Le delta vérifie le `baseHash` après restauration du snapshot, contrôle chaque checksum et applique les changements avec sauvegarde et rollback. Un delta n’est accepté que lorsque les services sont arrêtés.

Après la capture des métadonnées, le desktop construit spéculativement le delta
pendant que l’API provisionne la Sandbox. Ce résultat n’est utilisé que si la
négociation confirme une baseline exacte ; un miss ou une baseline seulement
compatible conserve le chemin archive complète.

La session persiste le `workspaceHash` effectivement importé. Après reprise du
même sandbox, une négociation dont la révision et le hash sont identiques, sans
delta durable en attente, court-circuite construction, upload, restauration et
import. Toute divergence reprend le chemin vérifié normal ; le hash n’est jamais
utilisé pour ignorer un conflit ou un writer distant.

Le plan de repli est explicite : image complète, runtime froid, synchronisation complète, puis warm-up normal. Un cache invalide, une baseline expirée ou un snapshot absent ne contourne jamais les contrôles de propriété, de digest, d’URL, de taille ou de génération.

## 16. Cycle de vie des baselines, quotas et mesure

Les états `building`, `ready`, `failed`, `expired` et `deleting` sont persistés. La construction est dédupliquée par verrou MySQL au niveau du fingerprint et limitée par des slots `BLAME_PREVIEW_BASELINE_MAX_BUILDERS`. Une baseline référencée par une session n’est jamais collectée. Le GC traite les échecs, les expirations et les baselines non référencées au-delà de `BLAME_PREVIEW_BASELINE_MAX_UNREFERENCED`, supprime d’abord le snapshot provider puis la Sandbox propriétaire, et laisse l’état `expired` en cas d’échec pour permettre une nouvelle tentative.

La reaper ne sélectionne que les sessions avec handle provider, deadline échue et état hôte non suspendu/détruit. La transition suspendue est idempotente : une seconde observation ne crée ni opération, ni événement, ni appel provider. Les sessions sans allocation provider ne consomment pas les quotas actifs et les vCPU ; les coûts restent calculés à partir des compteurs provider persistés.

Les phases `baseline.lookup`, `baseline.build`, `baseline.restore`, `baseline.delete`, `baseline.gc`, `workspace.sync`, `workspace.sync.skip`, `dockerd.start`, `compose.prepare`, `compose.prepare.cached`, `compose.pull`, `compose.build`, `dependencies.install`, `services.start` et `preview.readiness` sont mesurées avec durée et statut uniquement. Les attributs de télémétrie sont bornés et ne contiennent ni fingerprint complet, URL signée, contenu de fichier, commande, environnement ou secret.

Le benchmark reproductible local est `pnpm benchmark:preview-runtime`. Il crée un dépôt temporaire, mesure archive complète et delta, compare taille et durée, puis détruit son répertoire temporaire. Il ne contacte pas Vercel et ne lit aucun fichier `.env`.
