# TODO refacto `app/idle/core/` (branche `refacto`)

Fichier temporaire. A supprimer une fois la branche mergee.

Etat de reference : les commits du refacto sont fusionnes en `4775eaa`, contre `5d5dd36`
sur `main`. Les quatre checks passent.

## Revues deja faites

**2026-08-12, parite fonctionnelle.** Courbes d'upgrade algebriquement identiques,
`heat-config.ts` byte-identique, parite verifiee sur le passif, les roles, le shop, le
leaderboard et la pagination. Aucun code applicatif ne lit plus
`shells.json` / `upgrades.json`.

**2026-08-24, diff global** (129 fichiers). Trois correctifs appliques : path traversal de
l'API REST, `startBot()` qui court-circuitait la sequence d'arret, `DiscordRequest` qui
masquait le statut HTTP. Puis huit points « fragilites latentes » et « qualite », tous
traites.

**2026-09-02, diff global apres fusion** (133 fichiers, +11004 / -3977). Quatre defauts —
marqueur memoire faux dans 5 docs, boucle d'appels d'outils Gemini non bornee,
`npm run register` qui sortait toujours en 0, `/ask` qui pouvait ne jamais repondre — et
six points de coherence : erreur de `/leaderboard` non ephemere, `vitest.config.js` livre
dans `dist/`, `fileStore.invalidate()` sans appelant (retire), commentaire mort dans
`app/discord/types.ts`, clause obsolete dans `prompts.ts`, `guildId` non valide dans
`app/routes/guilds.ts`. **Tous corriges le jour meme.**

**Le detail est dans l'historique git ; ce qui devait survivre a ce fichier vit desormais
la ou ca sert** — motif tolerant du marqueur memoire (CLAUDE.md, `docs/storage.md`),
`MAX_TOOL_ROUNDS` et le dernier tour sans outils (CLAUDE.md, `docs/architecture.md`,
`docs/commands.md`), code de sortie de `register` (CLAUDE.md, `docs/configuration.md`),
frontiere du defer (`docs/architecture.md`, section « Error handling »), et pour les points
de coherence un commentaire sur place dans `tsconfig.build.json` et `app/routes/guilds.ts`.

Verifie et trouve bon lors de cette derniere passe : `files/` gitignore (aucune donnee de
guilde suivie), allowlist `GUILD_ID_PATTERN` sur les deux routes fichiers, purete de
`core/` confirmee sur le build (`decimal.js` et `zod` uniquement), aucun `export default`
hors `vitest.config.ts`, couple `getMaxBuyable` / `buyUpgrade` coherent (tout solde etant
entier, `ceil(totalCost) <= shells` tient toujours, donc pas de cas « max annonce N, achat
refuse »).

---

## Bloquant avant deploiement

- [ ] **Lancer la migration sur la prod** - `scripts/migrate-game-instances.ts`
    - Le script est ecrit et teste, il reste a l'executer sur les vrais fichiers.
    - Procedure : `tsx scripts/migrate-game-instances.ts` (dry run, ne touche a rien),
      lire le rapport, puis `--apply`.
    - **Lire les avertissements `income mismatch` avant d'appliquer.** Le script recopie
      l'income tel quel par defaut, donc aucun joueur ne change de revenu, mais un ecart
      signale que `shells.json` et `upgrades.json` ont derive. `--recompute-income` fait
      confiance aux niveaux plutot qu'a la valeur stockee.
    - Refuse d'ecraser un `game-instances.json` existant sans `--force` : une fois le bot
      demarre, c'est ce fichier qui fait foi et la paire legacy est perimee.
    - Les fichiers `shells.json` / `upgrades.json` sont laisses en place, l'API REST les
      expose toujours.

---

## Couverture

88,13 % global (274 tests, 36 fichiers, 1040/1180 stmts). Tres bonne la ou ca compte :
`idle/core` 99,5 %, `commons` 97,5 %, `routes` 96,0 %, `idle` 95,5 %, `commands` 93,3 %,
`storage` 84,4 %.

Les trous restants sont ce qui demande de mocker une lib externe, ce qui est coherent avec
la strategie tenue. Deux exceptions : `storage/index.ts`, ou seuls `startFileStore` /
`stopFileStore` manquent, et `storage/file-store.ts`, ou c'est le balayage des fichiers
inactifs.

| Zone                    | Stmts  |
| ----------------------- | ------ |
| `ollama/`               | 0 %    |
| `storage/index.ts`      | 14,3 % |
| `tools/weather.ts`      | 21,1 % |
| `discord/setup.ts`      | 27,3 % |
| `discord/handlers.ts`   | 62,0 % |
| `gemini/ask-gemini.ts`  | 70,4 % |
| `storage/file-store.ts` | 74,0 % |

---

## Housekeeping (au merge)

- [ ] Supprimer ce fichier.
- [ ] Decider du sort de `app/ollama/` : non cable (aucun import hors du dossier), 0 % de
      couverture, mais documente comme backend alternatif dans `docs/architecture.md` et
      CLAUDE.md. Si retire : la dependance npm `ollama` et `weatherToolOllama`
      (`app/tools/weather.ts`) deviennent morts a leur tour.
- [ ] Confirmer que `.claude/` (hooks lint/test + `settings.json`) doit rester versionne :
      ca impose les hooks a tout le monde sur le repo.
- [ ] Retirer `ShellsUser` / `UserUpgrades` et les types de fichier `shells` / `upgrades`
      une fois la migration prod passee et l'API REST nettoyee.
