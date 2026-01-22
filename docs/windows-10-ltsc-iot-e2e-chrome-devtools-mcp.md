# Windows 10 LTSC IoT — Setup propre (rapide + fiable) pour E2E via chrome-devtools-mcp

Objectif: exécuter des audits/tests E2E dans un vrai navigateur Chrome, piloté via `chrome-devtools-mcp`, avec un maximum de stabilité et un minimum de latence.

## 1) Pré-requis “propres” (Windows 10 LTSC/IoT)

### Node.js
`chrome-devtools-mcp` demande **Node >= 20.19**.

Recommandation pratique (fiabilité):
- **Préférer la LTS Node la plus récente** si votre environnement le permet.
- Si vous êtes contraint: installez **Node 20.19+** (puis pinnez la version pour éviter les surprises).

Options d’installation (du plus simple au plus « pinable »):
1) **MSI officiel Node.js** (simple, stable)
   - Installez une version LTS.
   - Vérifiez: `node -v` et `npm -v`.
2) **Gestionnaire de versions Node** (idéal si vous jonglez entre projets)
   - Utilisez un gestionnaire maintenu sur Windows (ex: `fnm` ou `nvs`).
   - Ajoutez un fichier de pin dans vos projets: `.node-version` ou `.nvmrc`.

### Chrome
- **Chrome Stable** (suffisant dans la majorité des cas).
- Pour un maximum de reproductibilité: utilisez un binaire “pinné” (ex: **Chrome for Testing**) et passez son chemin via `--executablePath`.

## 2) Configuration MCP (VS Code / Copilot)

Ajoutez un serveur MCP “chrome-devtools” qui lance `chrome-devtools-mcp`.

Config recommandée (stable + déterministe):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--viewport",
        "1280x720"
      ]
    }
  }
}
```

Pourquoi ces flags:
- `--isolated`: profil Chrome temporaire par run (réduit drastiquement la flakiness).
- `--viewport 1280x720`: rendu stable (screenshots/layout, clics, breakpoints).

Variantes utiles:
- **Ultra-rapide / CI**: ajouter `--headless`.
- **Debug**: retirer `--headless` + ajouter `--logFile <path>`.
- **Binaire Chrome spécifique** (pinné): ajouter `--executablePath C:\\Tools\\Chrome\\chrome.exe`.

Commandes de sanity-check:
- `npx -y chrome-devtools-mcp@latest --help`

## 3) Optimisations Windows (pour des E2E rapides et fiables)

### Profil & cache (I/O)
- Gardez les profils temporaires et caches sur un disque local rapide.
- Evitez les chemins très longs (Windows + node_modules).

### Antivirus / Defender (si vous contrôlez la machine)
- Si vous observez des timeouts “bizarres”, exclure le dossier des profils temporaires et caches Node de l’analyse temps réel peut stabiliser fortement.

### Déterminisme
- Toujours tester avec un viewport fixe.
- Eviter de réutiliser des profils entre runs parallèles.

## 4) Lancer un audit avec le nouvel agent

Dans Copilot Chat:
- `@e2e-ux-auditor Lance un audit E2E UX sur <votre app>`

L’agent:
- tente de découvrir la commande de démarrage et l’URL automatiquement,
- démarre le serveur si possible,
- pilote Chrome via `chrome-devtools-mcp`,
- écrit un rapport `.instructions-output/e2e-audit/...`,
- synchronise avec `.instructions/tasks.md` ou `.instructions/tasks/`.

## 5) Conseils pratiques (vitesse vs fiabilité)

- Pour une première passe “audit UX”: **headful** (non-headless) peut aider à repérer les problèmes visuels.
- Pour la répétabilité / CI: **headless + isolated + viewport fixe**.
- Pour éviter des surprises: remplacez `@latest` par une version précise, puis mettez-la à jour de temps en temps.
