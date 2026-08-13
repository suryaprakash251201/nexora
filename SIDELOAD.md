# Sideloading the iOS app without a Developer Account

The CI workflow (`mobile-build.yml`) builds an **unsigned `.ipa`** plus a
**simulator `.app`** on every push to `main` (or via
`Actions → Build Mobile App → Run workflow`).

There is **no Apple Developer account** involved in CI — which means the
app is not signed yet. You sign it locally on YOUR machine with a **free
Apple ID** using one of the tools below.

> Free Apple IDs work fine for personal sideloading, with two caveats:
> the install **expires after 7 days** and must be re-signed, and you can
> have at most **3 apps** sideloaded this way on one device at a time.

---

## What you get from CI

| Artifact | Purpose |
|---|---|
| `nexora-mobile-ios-ipa/nexora-mobile-unsigned.ipa` | Sideload to a real iPhone/iPad with a free Apple ID |
| `nexora-mobile-ios-simulator/nexora-mobile-simulator.app.zip` | Run in the iOS Simulator — **no signing at all** |
| `nexora-mobile-android/app-release.apk` | Android install (side-loadable) |

Download the artifact zip from the workflow run's **Summary → Artifacts**.

---

## Option A — Sideloadly (recommended, Windows / macOS)

1. Install [Sideloadly](https://sideloadly.io).
2. Plug your iPhone/iPad into the computer (USB) and trust it.
3. Open Sideloadly:
   - **IPA**: pick `nexora-mobile-unsigned.ipa`
   - **Apple ID**: enter your free Apple ID email + password
   - **Bundle ID**: it is auto-filled from the IPA
     (`dev.suryaprakash.nexora`)
4. Click **Start**. Sideloadly signs the app with your Apple ID and
   installs it.
5. On the phone: **Settings → General → VPN & Device Management → your
   Apple ID → Trust**.

Re-run every 7 days when the app stops launching (or use AltStore below
which can refresh automatically).

## Option B — AltStore (auto-refresh, macOS / Windows)

1. Install [AltServer](https://altstore.io) on your computer and
   [AltStore](https://altstore.io) on your phone.
2. Make sure your phone and computer are on the same Wi-Fi, and the
   computer is on & AltServer is running — AltStore uses it to re-sign.
3. In AltStore: **My Apps → + (top-right) →** select
   `nexora-mobile-unsigned.ipa` from Files.
4. Enter your free Apple ID when prompted. The app installs and AltStore
   can **refresh it before the 7-day expiry** automatically while
   AltServer is reachable.

## Option C — iOS Simulator (no Apple ID at all)

1. Unzip `nexora-mobile-simulator.app.zip`.
2. Open Xcode → **Xcode → Open Developer Tool → Simulator**.
3. Drag `Nexora.app` onto the simulator window — it installs and runs.

---

## App behavior notes

- The app talks to your Nexora server over HTTP; iOS requires
  `NSAppTransportSecurity → NSAllowsArbitraryLoads` which is already set
  in `app.json`, so LAN HTTP servers work.
- The first launch shows the login screen — enter your server address
  (e.g. `http://192.168.1.5:8080`) and credentials.

## Moving to a paid account (proper App Store / TestFlight)

1. Create a paid Apple Developer account and add your device to the
   portal.
2. Either use **EAS Build** (`eas build --platform ios`) with your Apple
   credentials, or build locally in Xcode:
   `npx expo run:ios` after selecting your team in `Signing & Capabilities`.
3. Update `app.json` if you need a different bundle identifier.

The unsigned build pipeline in CI is intentionally kept separate so the
repo never requires Apple credentials in GitHub Actions.
