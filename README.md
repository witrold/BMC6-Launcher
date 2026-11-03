# BMC6 Launcher

A small personal launcher for **Minecraft: Java Edition**, used to install and start one private NeoForge modpack shared with a few friends. Non-commercial.

_Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft._

## What it does

- Installs Minecraft (game, libraries, assets), the Java runtime published by Mojang, and NeoForge.
- Keeps the modpack (mods and configs) in sync with a manifest, and removes mods that were dropped from the pack.
- Starts the game with the configured memory. The interface is a local web page (`127.0.0.1` only), no extra install needed beyond Node.js (a portable build bundles it).

## Authentication and ownership

- The player **must sign in with a Microsoft account** before the game can be started. There is **no offline mode** and no way to skip the sign-in or the license check.
- Sign-in uses the OAuth 2.0 device code flow (scope `XboxLive.signin offline_access`), then Xbox Live, XSTS, `login_with_xbox`, and `minecraft/profile` on Minecraft Services. If the account has no Minecraft: Java Edition profile, launching is refused.
- Tokens are stored only on the player's computer in `%APPDATA%\BMC6Launcher\account.json`. Nothing is sent anywhere else, and the launcher has no telemetry.

## Run

Requires Node.js 22 or newer.

```
node tools/build-exe.js   # builds "BMC6 Launcher.exe" with the C# compiler that ships with Windows
```

Double-click `BMC6 Launcher.exe`: a native Windows application (WinForms, `app/Launcher.cs`). It starts the engine (`src/`, Node.js) hidden in the background and talks to it over a local-only HTTP API protected by a per-run token. Closing the window stops the engine; if a game is running, the window hides to the notification area and the launcher exits when the game closes.

Without the exe (development): `node src/main.js`, then open http://127.0.0.1:8780 for a browser version of the same interface. Game files go to `%APPDATA%\BMC6Launcher`.

Set `msClientId` in `pack.json` to your own Azure application (client) ID. It must be a public client, and Mojang must have approved it for Minecraft Services.

## Publish a new pack version

The pack (mods, configs) lives in a **private** GitHub repository (`pack.json` → `github`). Requires the GitHub CLI (`gh`), signed in.

```
node tools/publish.js <instance-folder> [--version <v>] [--server <host:port>] [--overwrite-config] [--dry-run]
```

- Each mod is uploaded once to the repository's release (named by its sha1); configs, shaders and resource packs go in a single zip.
- Files whose authors forbid third-party redistribution (CurseForge `allowModDistribution=false`) are **never uploaded**: the manifest points to the identical file (same sha1) on Modrinth.
- Configs are not overwritten on players' machines unless `--overwrite-config` is used; mods always are.

## Portable build for friends

Friends need a read-only token for the private pack repository (fine-grained token, `Contents: read` on that repository only). It goes only in the zip, never in this repository.

```
node tools/check-token.js <token>                                   # checks the token can read the pack
node tools/package.js --pack-token <token> [--server <host:port>]   # creates dist/BMC6Launcher.zip
```

The zip contains a portable Node.js and `BMC6 Launcher.exe`, so nothing has to be installed.

## Français (résumé)

Launcher personnel pour un modpack Minecraft entre amis. Il installe le jeu, Java et NeoForge, synchronise les mods, et lance le jeu. La connexion avec un compte Microsoft possédant Minecraft Java est obligatoire : il n'y a pas de mode hors-ligne. Les jetons restent sur l'ordinateur du joueur (`%APPDATA%\BMC6Launcher`).

## License

MIT, see `LICENSE`.
