# Spire Navigation & Settings Redesign — Production Plan

**Status:** 🔒 LOCKED FOR EXECUTION  
**Date:** 18 Nov 2026  
**Scope:** Android app (native shell), Spire WebView embed, and web-app embed mode. Desktop web parity is noted but is not the primary deliverable.  
**Goal:** Replace the current single-surface / one-long-settings-screen experience with a clear tabbed shell, a prominent Spire entry, a grouped settings hub, and a production-grade floating orb.

> **LOCKED PLAN — CHANGE CONTROL**
>
> This document is the execution contract. The information architecture, phase order, architecture decisions and acceptance criteria are frozen.
>
> **Only completion state may change:** mark a checkbox `[x]` and update the status board **after** the item is implemented and verified. Do not rewrite the specification to match the implementation.
>
> Any implementation detail that must differ from this document requires an explicit decision and a dated note in the status board. Do not silently re-scope.

---

## Execution status board

**Current phase:** Phase 0 — Decisions & baseline  
**Current state:** Not started. No phase is complete.  
**Update rule:** change `[ ]` to `[x]` only when the phase exit criteria are met and evidence is recorded.

- [ ] **Phase 0 — Decisions & baseline** — sign off the 10 open decisions; record startup/tab/Spire baseline; add feature-flag names.
- [ ] **Phase 1 — Core shell** — `NavigationState`, back reducer, `SpireAppScaffold`, bottom dock, Spire orb, immersive Spire, back bridge, WebView retained across tabs.
- [ ] **Phase 2 — Settings + floating orb** — Settings home, seven groups, settings search, Spire & AI, Floating Orb page, system orb redesign.
- [ ] **Phase 3 — Library + parity** — recent API, native Library, export/delete/share, plan/account, immersive parity gate.
- [ ] **Phase 4 — Tools** — native Tools home and existing-tool activation.
- [ ] **Phase 5 — Adaptive & polish** — NavigationRail, landscape, foldables, RTL, 200% font, reduced motion, haptics.
- [ ] **Phase 6 — Hardening** — performance, accessibility, security, localization, regression, `scripts/verify.sh`.
- [ ] **Phase 7 — Rollout** — staged rollout, monitoring, rollback drill, one stable release cycle.

**Next action:** finish Phase 0 decision sign-off, then start Phase 1A (`NavigationState.kt` + `reduceBack` tests).

### Pre-work already present (not a phase completion)

These were reliability fixes made before the redesign. They do not check any phase above.

- WebView scroll containment, touch ownership and IME padding.
- Failed-drop bubble recovery and stale trash/hide-target cleanup.
- Web account/settings scroll separated from the sidebar scroll.
- Spire WebView single-owner lifecycle remains intact.

### Phase 0 decision sign-off

- [ ] Confirm **four tabs + centre orb** (Search, Library, Tools, Settings; Spire is immersive, not a tab).
- [ ] Confirm **native Library** as the long-term home for chats/artifacts.
- [ ] Confirm **Tools as a tab** that launches existing search modes.
- [ ] Confirm bottom search bar + dock coexistence; dock hides on IME.
- [ ] Confirm launcher/overlay dock policy (optional in launcher; never in overlay).
- [ ] Confirm web header stays until Phase 3 parity is complete.
- [ ] Record baseline cold-start, tab-switch, Spire-warm and Spire-cold timings.
- [ ] Add the six feature-flag names and kill-switch wiring.
- [ ] Sign off the 10 decisions in §10.

**Phase 1A implementation slice**

1. Add `app/navigation/NavigationState.kt`.
2. Add `reduceBack(state)` and unit tests for every §4.4 row.
3. Map `RootDestination` to `RootTab` + `AppOverlay` behind `NAVIGATION_DOCK`.
4. Keep `ChatWebViewStore` owned by `MainAppDestination`; do not create a second WebView.
5. Add the shell/dock only after the reducer and flags are green.

---

## 0. The blunt version

The current app has four root destinations and no bottom navigation:

- `Search`
- `WidgetsPanel`
- `Settings`
- `Bot` (Spire chat)

Settings is one long vertical scroll. Spire is a hidden destination reached through search, Ask Spire, share, or a deep link. The floating button is an accessibility overlay, not part of the app’s navigation.

The proposed shell is:

```
Search   Library   [ Spire orb ]   Tools   Settings
```

Spire is **not a tab**. It is a full-screen immersive destination with no bottom nav and only back navigation.

This is not a cosmetic change. It touches navigation state, WebView lifecycle, back handling, insets, settings architecture, accessibility, and the floating overlay. It must be phased and feature-flagged.

“100% prod ready” is not a document claim. It is the gate list in §8. Do not ship until every gate passes.

---

## 1. Current state (verified against the code)

| Area | Current behaviour | Evidence |
|---|---|---|
| Root destinations | `RootDestination { WidgetsPanel, Search, Settings, Bot }`; no bottom nav | `quick-search/.../app/navigation/NavigationManager.kt` |
| Shell transitions | `AnimatedContent` between root destinations; `Bot` is full-screen | `NavigationManager.kt` |
| Spire back | WebView back first, then exit to Search | `ChatScene.kt` |
| Search chrome | Settings gear, swipe-right Widgets, optional bottom search bar | `SearchScreenContent.kt`, `UiPreferencesCore.kt` |
| Settings | One long scroll with cards; detail pages via `SettingsDetailType` | `SettingsScreen.kt`, `SettingsDetailType.kt` |
| Floating button | Accessibility overlay; tap = search, long-press = Quick Search / Live / Ask Spire; drag, drop, hide | `FloatingButtonOverlay.kt`, `FloatingMenuView.kt` |
| Floating visibility | Hidden while an app surface is resumed | `LockScreenAccessibilityService.kt` |
| WebView | One retained WebView owned by `ChatWebViewStore`; `?embed=android` preserved | `ChatWebViewStore.kt`, `lib/embed.ts` |
| Web chat chrome | Header, sidebar, usage, export remain inside the WebView | `components/chat/shell.tsx`, `chat-header.tsx`, `app-sidebar.tsx` |
| Overlay mode | Separate `OverlayActivity` renders search directly | `OverlayActivity.kt` |
| Launcher mode | `HomeActivity` subclass with wallpaper backdrop | `HomeActivity.kt` |
| Feature flags | Infrastructure exists; enum is currently empty | `shared/featureFlags/FeatureFlags.kt` |
| Analytics | No analytics/tracking by design | `quick-search/README.md`, `AGENTS.md` |

### What this means

- There is no existing bottom-nav state machine to extend. One must be designed, not “turned on.”
- Spire already has a correct WebView ownership model. Preserve it. Do not create a second WebView.
- Settings already has a detail-page state machine. Reuse it; add a group layer above it.
- The floating orb already has most behaviours. Redesign it; do not rewrite it from scratch.
- The web app currently assumes it owns its header/sidebar. Immersive Spire requires a real embed mode, not just a query parameter.

---

## 2. Goals and non-goals

### Goals

1. Give every major feature a clear home.
2. Make Spire the most prominent action without making it a persistent nav bar.
3. Make settings discoverable through groups and search instead of one long scroll.
4. Make the floating orb a first-class, branded, reliable system-wide entry point.
5. Preserve search speed, launcher behaviour, overlay mode, and existing deep links.
6. Ship with production-grade accessibility, insets, RTL, tablets, process-death recovery, tests, and rollback.

### Non-goals

- Rebuilding the web chat or its AI capabilities.
- Adding new AI tools or search providers.
- A full native artifact editor.
- iOS or desktop parity in this phase.
- Replacing the existing accessibility overlay with Android’s bubbles API.

---

## 3. Final information architecture

### 3.1 Android shell

```
┌──────────────────────────────────────────────┐
│                                              │
│                Tab content                   │
│                                              │
│                                              │
│   [ Search ] [ Library ] ( Spire ) [ Tools ] [ Settings ]
│                                              │
└──────────────────────────────────────────────┘
```

- Four tabs: **Search, Library, Tools, Settings**.
- A raised **Spire orb** sits between Library and Tools.
- The orb opens a new Spire chat in immersive mode.
- The dock is hidden in Spire, settings detail pages, onboarding, overlay mode, and while the IME is visible.
- On tablets (≥ 600 dp), the dock becomes a **NavigationRail** with the orb at the top or bottom.

### 3.2 Destination definitions

| Destination | Purpose | Primary content | Back behaviour |
|---|---|---|---|
| **Search** | The home surface and launcher | Search bar, At a Glance, suggestions, results, Widgets panel | Clear query → close keyboard → close Widgets → move task back |
| **Library** | Saved Spire work | Chats and artifacts, filters, search, open, export/delete | Clear search/filter → return to Search |
| **Tools** | Native utilities | Calculator, converters, date/time, reminders, notes, alarms, weather, dictionary, custom tools | Return to Search |
| **Settings** | Configuration | Account, Spire & AI, Search, Appearance, Tools, Gestures & Access, Data & Privacy, About | Return to previous tab |
| **Spire** | AI chat, immersive | WebView chat + composer + artifact overlay | Close artifact/modal → WebView back → return to origin tab |

### 3.3 Spire immersive rules

- **No bottom nav.**
- **No native header.**
- **No web sidebar or web header in `?embed=android`.**
- The WebView fills the screen; native handles status/navigation bar insets.
- Only back navigation exits.

#### Entry points

| Entry | Behaviour |
|---|---|
| Dock Spire orb | New chat |
| Search “Ask Spire” row | Chat with the query |
| Library chat/artifact | Existing chat or artifact |
| Share intent / App Link | Chat with shared content |
| System orb long-press → Ask Spire | Chat with the query |
| Quick Ask sheet → Ask | Chat with the query |
| Spire Live → Open in Spire | Continue the Live conversation |

#### Exit sequence

1. If the IME is open → hide it.
2. If the web app reports an open artifact, modal, or sheet → close it via the JS bridge.
3. Else if the WebView can go back → go back.
4. Else → return to the tab that opened Spire.

Track the origin:

```kotlin
enum class SpireOrigin { SEARCH, LIBRARY, TOOLS, SETTINGS, EXTERNAL, SHARE, LIVE, QUICK_ASK }
```

If the origin tab no longer exists (e.g. deep link), return to Search.

#### Feature parity before hiding the web header

Hiding the web header removes these functions. They must be replaced before immersive mode becomes the default:

| Web header feature | Native replacement | Phase |
|---|---|---|
| Sidebar / chat history | Library tab | 3 |
| New chat | Dock Spire orb | 1 |
| Visibility (private/public) | Default private; Settings → Spire & AI → Chat visibility | 3 |
| Workspace toggle | Tool cards open the artifact; back/close returns | 1 |
| Plan usage | Settings → Spire & AI → Plan & usage | 2 |
| Export conversation | Library item overflow → Export chat | 3 |
| Account / sign in | Settings → Spire & AI → Account | 2 |

**Ship rule:** do not enable immersive mode by default until the Phase 3 parity items are done. Until then, keep the web header behind a feature flag.

### 3.4 Settings groups

Replace the single long settings screen with a settings home and seven groups:

| Group | Contents |
|---|---|
| **Spire & AI** | Account, plan & usage, AI provider/API key, Spire Live, Ask Spire behaviour, chat visibility, clear Spire data |
| **Search** | Search results, app management, app shortcuts, device settings, calendar, reminders, notes, calls & texts, files, notification history, ranking, nicknames, triggers, excluded items, search engines |
| **Appearance** | Theme, wallpaper, layout, font, icon pack, search bar style, home text colour, app icon, AMOLED, Material You, compact layout, bottom search bar, settings/mic icons, navigation labels |
| **Tools** | Tools settings, unit converter info, date calculator info, custom tools, Tasker |
| **Gestures & Access** | Home gestures, keyboard gestures, launch options, edge swipe, floating orb, overlay mode, default assistant, default launcher |
| **Data & Privacy** | Backup & restore, export settings, permissions, privacy policy |
| **About** | Release notes, features list, version, feedback, rate, open-source licences |

Settings home also shows an account/Spire card at the top:

```
Spire
Guest / user@email.com · Free plan
[Open Spire]  [Sign in]
```

Settings search sits above the groups and searches every row, with breadcrumbs:

```
Settings > Gestures & Access > Floating Orb
```

### 3.5 Floating orb system

There are two visual twins:

| Orb | Where | Behaviour |
|---|---|---|
| **Dock orb** | In-app bottom dock | Tap = new Spire chat; long-press = accessible menu with New chat / Live / Ask |
| **System orb** | Accessibility overlay over other apps | Tap = Search; long-press = Quick Search / Live / Ask Spire; drag, snap, drop to Spire, hide |

They share the same mark, ring, colours, haptics, and motion. The system orb is hidden whenever an app surface is resumed; the dock orb is hidden whenever Spire is open. Users should never see both at once.

---

## 4. Interaction specification

### 4.1 Bottom dock

**Structure**

- Material 3 `NavigationBar` styling as the base, wrapped in a floating pill container.
- Four `NavigationBarItem`s and a centre orb overlay.
- Container: 28 dp corner radius, 1 dp border, translucent surface, soft shadow, 12 dp horizontal margin, 12–16 dp bottom margin above the navigation-bar inset.
- Height: 64 dp content; orb 56 dp raised 12–14 dp.

**States**

| State | Visual |
|---|---|
| Default | Pill visible, selected tab has a soft accent indicator |
| Pressed tab | Icon scales to 0.94, light haptic |
| Orb pressed | Orb scales to 0.94, medium haptic |
| Spire opening | Orb expands/fades into the chat; dock slides down |
| IME open | Dock hides; content and search bar remain above keyboard |
| Tablet | NavigationRail; orb at top/bottom |
| Reduced motion | No scale/reveal; crossfade only |

**Labels**

- Show labels for all four tabs by default.
- On widths below 360 dp, show the selected label only.
- The orb has a small optional “Spire” label; default on for discoverability, configurable in Appearance → Navigation.

**Insets**

- The shell owns the bottom inset. Do not let individual tabs apply a second navigation-bar inset.
- `SpireAppScaffold` provides `PaddingValues` to tab content.
- Search’s bottom search bar sits above the dock; the dock hides on IME.
- Settings detail and Spire bypass the scaffold and own their insets.

**Accessibility**

- Each tab: `Role.Tab`, `selected`, content description, `stateDescription`.
- Orb: `Role.Button`, “Spire, start a new chat”.
- Long-press menu: a standard accessible popup, not only a custom radial gesture.
- Minimum 48 dp touch targets; contrast ≥ 4.5:1; font scale up to 200%; RTL mirrored.
- TalkBack announces tab changes; focus order is left-to-right.

**Adaptive**

- Width < 600 dp: bottom dock.
- Width ≥ 600 dp: `NavigationRail` with the same destinations and orb.
- Landscape phone: bottom dock with reduced height; test gesture and 3-button navigation.
- Foldable: use `WindowSizeClass`; do not stretch the dock across a half-open hinge.

### 4.2 Spire orb (system overlay)

| State | Trigger | Visual | Action |
|---|---|---|---|
| Idle | Enabled, app not foreground | 44 dp orb, 85% opacity, subtle ring | Tap = Search |
| Pressed | Touch down | Scale 0.92, ring brightens | — |
| Dragging | Move | Scale 1.06, shadow grows, snaps to edge | Drop = persist position |
| Fan open | Long-press | Three labelled actions in an arc | Search / Live / Ask Spire |
| Drop hover | Drag content over orb | Expands to “Drop to Spire” card | Import to new chat |
| Hidden | App foreground, lock screen, Spire open, IME, hidden-until-unlock | No view | — |
| Disabled | Accessibility off | No view; settings shows setup card | — |
| Error | Permission lost / service killed | Watchdog recovers; settings shows status | — |

**Settings page: Gestures & Access → Floating Orb**

- Enable/disable.
- Live preview.
- Size slider (36–56 dp).
- Opacity slider (40–100%).
- Edge snap: auto / left / right.
- “Show now” when hidden until unlock.
- Test actions: Tap, Long-press, Drag, Drop.
- Reset position.
- “How it works” explainer.
- Accessibility disclosure.

**Accessibility**

- Content description: “Spire. Tap to search. Long-press for Spire Live and Ask Spire.”
- Custom accessibility actions for Search, Live, Ask Spire.
- The radial fan has a standard popup fallback for TalkBack.
- Haptics on open/selection; respect system haptic settings.

**Reliability**

- Keep the existing visibility watchdog and power-state handling.
- Clamp position after rotation, multi-window, and display-size changes.
- Hide in multi-window when the app is visible.
- Respect reduced motion; no infinite animation.
- Do not read screen content; only dragged content and explicit actions.

### 4.3 Spire transitions

- Orb tap → scale/fade to a full-screen Spire surface, 220–260 ms.
- Show the existing skeleton until `onWebReady`.
- On back, reverse; restore the dock and the origin tab.
- Do not use experimental shared-element APIs unless the Compose version supports them stably. A custom overlay animation is safer.
- Reduced motion: crossfade only.

### 4.4 Back stack

Use a pure reducer, not scattered `BackHandler`s.

```kotlin
enum class RootTab { SEARCH, LIBRARY, TOOLS, SETTINGS }

sealed interface AppOverlay {
    data class Spire(val origin: RootTab, val launch: BotLaunch) : AppOverlay
    data object WidgetsPanel : AppOverlay
}

data class SettingsState(
    val group: SettingsGroup? = null,
    val detail: SettingsDetailType? = null,
    val previousDetail: SettingsDetailType? = null,
)

data class NavigationState(
    val tab: RootTab = RootTab.SEARCH,
    val overlay: AppOverlay? = null,
    val settings: SettingsState = SettingsState(),
)
```

Back rules:

| Current state | Back result |
|---|---|
| Spire, web artifact/modal open | Close it via bridge |
| Spire, WebView can go back | WebView back |
| Spire at root | Return to `origin` |
| Settings detail | Previous detail or group |
| Settings group | Settings home |
| Settings home | Return to previous tab |
| Library with search/filter | Clear search/filter |
| Library default | Return to Search |
| Tools detail | Tools home |
| Tools home | Return to Search |
| Search with query | Clear query |
| Search with keyboard | Hide keyboard |
| Search with Widgets panel | Close Widgets |
| Search default | Move task to back (launcher: stay home) |

### 4.5 Search integration

- Keep the search bar and results unchanged.
- Hide the settings gear by default when the dock is enabled; keep the `Settings icon` toggle in Appearance.
- Keep swipe-right for Widgets.
- Remove swipe-left → Settings; the Settings tab replaces it. Keep the gesture configurable for power users, but default off.
- Keep the `Ask Spire: <query>` row. Tapping opens Spire immersive.
- Keep the `Spire library` row. Tapping an item opens the chat/artifact; “Open library” switches to the Library tab.
- Bottom search bar:
  - If enabled, it sits above the dock.
  - The dock hides when the IME is visible.
  - Test on 320 dp width and 200% font scale.
  - If the layout is too cramped, offer “Search bar: Top / Above tabs” and default to Top for new installs.

### 4.6 Library tab

**Purpose:** a native home for Spire chats and artifacts, so the WebView can stay immersive.

**Layout**

```
Library
[ Search chats and files... ]
[ All ] [ Chats ] [ Images ] [ PDFs ] [ Sheets ] [ Documents ] [ Audio ] [ Notebooks ] [ Slides ]

┌──────────────────────────────────────┐
│ [icon] Passport photo                │
│        Image · 2 hours ago       ›   │
├──────────────────────────────────────┤
│ [icon] Quarterly report summary      │
│        Chat · yesterday          ›   │
└──────────────────────────────────────┘
```

**Behaviour**

- Load recent items from the web app with the WebView cookie.
- Debounced search; server-side filter by kind/source.
- Pagination: 30 per page, load more on scroll.
- Pull-to-refresh.
- Tap chat → Spire `/chat/:id`.
- Tap artifact → Spire `/library?document=:id`.
- Long-press: Open, Share, Export chat, Delete (with confirmation).
- Empty state: “Nothing here yet. Ask Spire to make something.” + “Open Spire” button.
- Error state: retry; if 401, “Sign in to Spire”.
- Loading state: skeleton rows.
- No offline cache in v1; add Room cache in a later phase if needed.

**API**

Extend `GET /api/spire`:

```
GET /api/spire?recent=1&limit=30&cursor=<createdAt>_<id>&kind=image&source=document
```

- Auth required.
- If `q` is empty and `recent=1`, return recent documents + chats.
- Cursor pagination by `(createdAt, id)`.
- Max limit 50.
- Response: `{ items: [...], nextCursor: string | null }`.
- Reuse `getDocumentsForUser`, `searchChatsByUserId` or add a recent-chats query.

Android `SpireLibraryRepository`:

- Add `recent(limit, cursor, kind, source)`.
- Keep the TTL cache.
- Parse `source`, `kind`, `title`, `createdAt`, `href`.
- 401 → signed-out state.
- Network errors → retry.

### 4.7 Tools tab

**Purpose:** make native utilities discoverable without hunting through search aliases.

**Categories**

| Category | Tools |
|---|---|
| Calculate | Calculator, Unit converter, Currency converter, Date & time |
| Organize | Reminders, Notes, Alarms & timers |
| Discover | Weather, Dictionary, World clock, Colour visualiser |
| Automate | Custom AI tools, Tasker |

**Behaviour**

- Each card has icon, title, subtitle, and enabled state.
- Disabled tools show “Enable in Settings → Tools”.
- Tapping a calculate/discover tool switches to Search with the tool alias/mode active. This reuses the existing engines and avoids duplicating UI.
- Tapping Reminders/Notes/Alarms opens the existing native form/dialog directly.
- “Customise” icon opens Settings → Tools.
- Optional bottom card: “Create with Spire” (Edit a photo, Merge PDFs, Summarise a document) opens Spire with a draft prompt. Keep it visually separate so Tools remains native utilities.

**Why not duplicate tool UIs:** the search tool engines are already tested and wired. A Tools tab that launches the exact same mode is lower risk and keeps one source of truth.

### 4.8 Settings

**Settings home**

- Account/Spire card.
- Search settings field.
- Seven group cards with icon, title, subtitle, and a live summary (e.g. “Floating Orb · On”, “Theme · Mono”, “AI · Connected”).
- “Recently changed” optional; not in v1.

**Group pages**

- `LazyColumn` of `SettingsCard` rows.
- Existing detail pages reused.
- Inline toggles (Overlay mode, Floating orb) can stay on the group page.
- Nested pages keep the existing `SettingsDetailType` state machine.

**Search**

- Extend `AppSettingsRepository` with group names, row titles, and keywords.
- Results show breadcrumbs.
- Tapping a result opens the exact group/detail.
- Empty state: “No settings found.”

**Back**

- Detail → previous detail or group.
- Group → Settings home.
- Settings home → previous tab.

**Deep links**

- Existing `SettingsDetailType` intents still resolve.
- Map each detail to its group.
- `ACTION_OPEN_NOTIFICATION_HISTORY` → Settings → Search → Notification History.
- `ACTION_OPEN_MANAGE_APPS` → Settings → Search → App Management.
- `ACTION_OPEN_WIDGETS_PANEL` remains a Search overlay, not a tab.

### 4.9 System floating orb details

Keep the existing architecture:

- Accessibility service owns the overlay.
- `FloatingButtonOverlay` draws and manages the view.
- `FloatingMenuView` draws the fan.
- `QuickAskActivity` handles the quick ask sheet.
- `SpireLiveActivity` handles Live.
- `FloatingDropController` handles drag/drop.
- `FloatingPowerState` handles lock/unlock and service restarts.

Redesign:

- Replace the generic search icon with the Spire mark.
- Add the shared orb ring/shadow spec.
- Rename settings from “Floating Button” to “Floating Orb” in the UI (keep the preference keys for migration).
- Add “Test actions” and “Reset position”.
- Add a preview in the settings page.
- Add a one-time onboarding tip after enabling.
- Add a “Why accessibility?” disclosure row.

---

## 5. Architecture and implementation

### 5.1 State model

Introduce a single `NavigationState` and a pure `reduceBack` function. Keep `RootDestination` temporarily for compatibility, then delete it after all call sites migrate.

```kotlin
// app/navigation/NavigationState.kt
enum class RootTab { SEARCH, LIBRARY, TOOLS, SETTINGS }

sealed interface AppOverlay {
    data class Spire(val origin: RootTab, val launch: BotLaunch) : AppOverlay
    data object WidgetsPanel : AppOverlay
}

data class SettingsState(
    val group: SettingsGroup? = null,
    val detail: SettingsDetailType? = null,
    val previousDetail: SettingsDetailType? = null,
)

data class NavigationState(
    val tab: RootTab = RootTab.SEARCH,
    val overlay: AppOverlay? = null,
    val settings: SettingsState = SettingsState(),
)
```

`MainAppDestination` becomes the host:

- Owns `ChatWebViewStore`.
- Renders `SpireAppScaffold` for tabs.
- Renders `SpireImmersive` for the Spire overlay.
- Renders `SettingsDetail` full-screen.
- Renders `WidgetsPanel` full-screen or as a side panel.
- Passes `NavigationState` and callbacks down.

`NavigationRequest` becomes:

```kotlin
data class NavigationRequest(
    val tab: RootTab = RootTab.SEARCH,
    val overlay: AppOverlay? = null,
    val settingsGroup: SettingsGroup? = null,
    val settingsDetailType: SettingsDetailType? = null,
    val spireLaunch: BotLaunch? = null,
    val settingsImportUri: String? = null,
    val requestId: Long = nextId(),
)
```

### 5.2 Android file map

| File | Change |
|---|---|
| `app/navigation/NavigationManager.kt` | Replace `RootDestination` with `RootTab` + `AppOverlay`; add dock; extract `SpireAppScaffold`; update transitions; remove settings swipe-left |
| `app/navigation/NavigationState.kt` | **New** — state model and back reducer |
| `app/navigation/MainAppDestination.kt` | Host tabs, Spire, Settings; own `ChatWebViewStore`; track origin |
| `app/MainActivity.kt` | Map intents to new state; add App Links; update `NavigationRequest`; keep overlay/launcher paths |
| `chat/ChatScene.kt` | Immersive Spire; hide dock; back bridge; IME/insets; auth prompt |
| `chat/ChatWebViewStore.kt` | Add `consumeBack`, `setBackConsumes`, `openNewChat`, `openLibrary`, `openAccount`; keep one WebView |
| `chat/SpireDeviceBridge.kt` | Add `setBackConsumes(Boolean)`; keep origin checks |
| `chat/SpireLibraryRepository.kt` | Add recent/pagination/filter calls |
| `settings/settingsScreen/SettingsScreen.kt` | Replace long scroll with `SettingsHome`; extract rows into groups |
| `settings/settingsDetailScreen/SettingsGroup.kt` | **New** — group enum and registry |
| `settings/settingsDetailScreen/SettingsDetailType.kt` | Keep; add group mapping and back targets |
| `settings/settingsDetailScreen/FloatingButtonSettings.kt` | Rename UI to Floating Orb; add preview/test/reset |
| `settings/settingsDetailScreen/SpireSettings.kt` | **New** — account, plan, Live, Ask behaviour |
| `settings/settingsScreen/SettingsSearch.kt` | **New** — search across groups |
| `library/LibraryScreen.kt` | **New** — native library list |
| `library/LibraryViewModel.kt` | **New** — loading, paging, filters, errors |
| `tools/ToolsScreen.kt` | **New** — tool hub |
| `tools/ToolsViewModel.kt` | **New** — enabled tools, actions |
| `shared/ui/components/SpireBottomDock.kt` | **New** — dock and orb |
| `shared/ui/components/SpireOrb.kt` | **New** — shared orb visual |
| `floatingButton/FloatingButtonOverlay.kt` | Redesign to Spire orb; share spec |
| `floatingButton/FloatingMenuView.kt` | New fan visuals; accessible popup fallback |
| `search/searchScreen/SearchScreenContent.kt` | Dock padding, hide gear, bottom search bar coexistence, Widgets |
| `search/searchScreen/searchRoute/SearchRoute.kt` | Tool activation hooks; Spire library callbacks |
| `overlay/OverlayActivity.kt` | Ensure dock never renders in overlay |
| `app/HomeActivity.kt` | Launcher-mode dock policy |
| `search/data/preferences/UserAppPreferences.kt` | New prefs and migration |
| `settings/appSettings/AppSettingsRepository.kt` | New searchable rows and group metadata |
| `shared/featureFlags/FeatureFlags.kt` | Add flags |
| `res/values/strings.xml` + 16 locales | New strings |
| `app/src/test/...` | State reducer, mapping, visibility tests |
| `app/src/androidTest/...` | Compose UI and WebView back tests |

### 5.3 Web app embed changes

| File | Change |
|---|---|
| `lib/embed.ts` | Keep `isAndroidEmbed`; add `useIsAndroidEmbed` hook |
| `app/(chat)/layout.tsx` | Render sidebar only when not embedded |
| `components/chat/app-sidebar.tsx` | Hide in embed |
| `components/chat/chat-header.tsx` | Hide in embed |
| `components/chat/shell.tsx` | Full-height embed layout; no header; keep composer/artifacts |
| `components/chat/artifact.tsx` | Full-screen on embed; close/back bridge |
| `hooks/use-android-back.ts` | **New** — set `SpireAndroid.setBackConsumes`; register `window.__spireHandleBack` |
| `app/(auth)/layout.tsx` | Hide the right preview panel in embed |
| `app/globals.css` | `html[data-embed="android"]` safe-area/scroll rules |
| `app/api/spire/route.ts` | Add recent/pagination/filter |
| `app/api/chat/export/route.ts` | **New** — Markdown export for native Library |
| `app/(chat)/api/chat/route.ts` | No functional change; keep tool map |

**Back bridge contract**

Web:

```ts
// when an artifact, dialog, or sheet opens/closes
window.SpireAndroid?.setBackConsumes?.(isSomethingOpen);

// native calls this when backConsumes is true
window.__spireHandleBack = () => {
  if (artifactOpen) { closeArtifact(); return true; }
  if (dialogOpen) { closeDialog(); return true; }
  return false;
};
```

Android:

```kotlin
BackHandler {
    if (imeVisible) { hideIme(); return@BackHandler }
    if (store.consumeBack()) return@BackHandler
    if (store.canGoBack()) store.goBack() else onExit()
}
```

`store.consumeBack()`:

```kotlin
fun consumeBack(): Boolean {
    if (!bridge.backConsumes) return false
    webView.evaluateJavascript("window.__spireHandleBack && window.__spireHandleBack()", null)
    return true
}
```

### 5.4 Data and API

- Extend `/api/spire` for recent items and pagination.
- Add `/api/chat/export` for Markdown export.
- Reuse `/api/chat?id=` DELETE and `/api/document?id=&timestamp=` DELETE for Library long-press.
- Reuse `/api/usage` for the native plan card.
- Reuse `SpireSessionRepository` for account state.
- Do not add a second WebView for Library.

### 5.5 Preferences and migration

Add to `UserAppPreferences` / `UiPreferences`:

| Key | Default | Purpose |
|---|---|---|
| `navigation_dock_enabled` | true | Master switch for the dock |
| `navigation_labels_visible` | true | Tab labels |
| `last_root_tab` | SEARCH | Restore tab |
| `spire_immersive` | false until Phase 3 | Immersive Spire flag |
| `library_view_mode` | list | List/grid |
| `tools_view_mode` | grid | Grid/list |
| `settings_home_v2` | true | New settings home |
| `floating_orb_style` | spire | Orb visual |
| `ask_spire_send_mode` | ask | Send immediately vs draft |
| `chat_visibility_default` | private | Default visibility |

Migration:

- Existing `bottomSearchBarEnabled` is preserved.
- Existing `settingsIconEnabled` is preserved; default off only for new installs.
- Existing floating button preferences keep their keys; only labels change.
- Existing `SettingsNavigationMemory` is extended, not reset.
- Show a one-time “What’s new” tip after the dock appears.

### 5.6 Feature flags

Add to `FeatureFlag`:

- `NAVIGATION_DOCK`
- `SPIRE_IMMERSIVE`
- `LIBRARY_TAB`
- `TOOLS_TAB`
- `SETTINGS_HOME_V2`
- `FLOATING_ORB_V2`

Rollout:

1. Internal dogfood.
2. Beta channel.
3. 10% production.
4. 50%.
5. 100%.

Each flag has a kill switch. If a flag is off, the old root navigation and old settings screen must still work. This means the old code path cannot be deleted until 100% rollout is stable for one release cycle.

### 5.7 Strings and localization

- All new strings in `res/values/strings.xml`.
- Update all 16 localized `values-*/strings.xml`.
- Use `scripts/add_strings.py` and `StringResourceParityTest`.
- Run `python3 scripts/check_strings.py`.
- Do not translate brand names, aliases, or technical identifiers.

### 5.8 Security

- Keep the WebView host allowlist.
- Keep external links in Custom Tabs.
- Keep `allowFileAccess = false`, `allowContentAccess = false`, `mixedContentMode = NEVER_ALLOW`.
- Keep `setSupportMultipleWindows(false)`.
- Restrict the JS bridge to the chat origin; review `addJavascriptInterface` exposure.
- The floating overlay must never read screen content.
- The drop feature reads only dragged content.
- Device actions keep the native Allow/Cancel dialog.

### 5.9 Performance budgets

| Metric | Budget |
|---|---|
| Cold start to first frame | no regression > 10% |
| Tab switch | < 100 ms perceived |
| Spire open (warm) | < 300 ms to skeleton, no reload |
| Spire open (cold) | < 1.5 s to interactive |
| Memory | baseline + 30 MB max |
| Dropped frames | < 1% on mid-range devices |
| ANR | 0 in pre-launch report |

Do not preload the WebView on launch; create it on first Spire open, then keep it alive.

### 5.10 Accessibility and adaptive layout

- TalkBack: tabs, orb, fan menu, settings rows, library rows.
- 48 dp minimum touch targets.
- Font scale 200%.
- RTL mirroring.
- Reduced motion.
- High contrast / AMOLED.
- Tablets: NavigationRail.
- Foldables: WindowSizeClass.
- Landscape: test both nav modes.
- Hardware keyboard: focus order and tab navigation.
- Predictive back: test Android 13+; use `OnBackPressedCallback` and verify the animation.

---

## 6. Phased delivery

Estimates assume one experienced Android engineer; halve with two working in parallel.

| Phase | Deliverable | Exit criteria | Estimate |
|---|---|---|---|
| **0. Decisions & baseline** | Final IA, wireframes, state model, feature flags, baseline metrics | Decisions signed off; baseline startup/tab/Spire timings recorded | 2–3 days |
| **1. Core shell** | `NavigationState` reducer, `SpireAppScaffold`, bottom dock, Spire orb, Spire immersive shell, back bridge | Tabs work; Spire opens/closes; back never exits incorrectly; WebView never reloads on tab switch | 1.5–2 weeks |
| **2. Settings + floating orb** | Settings home/groups/search, Spire & AI group, Floating Orb page, system orb redesign | Every old setting is reachable; settings search finds it; orb preview/test works | 1.5–2 weeks |
| **3. Library + parity** | Native Library, recent API, export/delete/share, plan usage, account | Library opens chats/artifacts; export/delete work; immersive mode can hide web header safely | 1–1.5 weeks |
| **4. Tools** | Tools home, tool activation, disabled-tool states | Every tool is discoverable; tapping opens the right mode; no duplicate engines | 1 week |
| **5. Adaptive & polish** | NavigationRail, landscape, foldables, RTL, font scale, reduced motion, haptics | Tablet/landscape/RTL/200% font pass | 1 week |
| **6. Hardening** | Performance, accessibility, security, localization, regression | All gates in §8 pass; `scripts/verify.sh` passes | 1–1.5 weeks |
| **7. Rollout** | Staged rollout, monitoring, rollback drills | 100% stable for one release cycle | 2–4 weeks |

**Total:** roughly 9–12 weeks for one engineer, 5–7 weeks for two, plus rollout.

### 6.1 Phase 1 implementation checklist (the critical path)

- [ ] Create `NavigationState.kt` with `RootTab`, `AppOverlay`, `SettingsState`, `SpireOrigin`.
- [ ] Write `reduceBack(state)` and unit tests for every row in §4.4.
- [ ] Add `SpireAppScaffold` with a single owner of bottom insets.
- [ ] Build `SpireBottomDock` using Material 3 `NavigationBar` + centre orb overlay.
- [ ] Add `SpireOrbSpec` (size, ring, colours, motion) shared by dock and system orb.
- [ ] Wire `MainAppDestination` to the new state; keep `ChatWebViewStore` alive across tabs.
- [ ] Render the dock only on `SEARCH`, `LIBRARY`, `TOOLS`, `SETTINGS`.
- [ ] Hide the dock in `SPIRE`, settings detail, onboarding, overlay, and IME.
- [ ] Add `SpireImmersive` full-screen destination; no native header.
- [ ] Add `SpireDeviceBridge.setBackConsumes(Boolean)` and `ChatWebViewStore.consumeBack()`.
- [ ] Add web `useAndroidBack` hook; set the flag for artifact/dialog/sheet state.
- [ ] Implement back sequence: IME → web overlay → WebView history → origin tab.
- [ ] Track `SpireOrigin` for orb, search, library, share, Live, Quick Ask, external.
- [ ] Add feature flags and fall back to the old root navigation when off.
- [ ] Add a one-time dock/orb coach mark.
- [ ] Verify no WebView reload on tab switch; verify streaming survives.
- [ ] Run the Phase 1 manual matrix on a small phone, a large phone, and a tablet.

### 6.2 Phase 2 implementation checklist

- [ ] Create `SettingsGroup` and map every `SettingsDetailType` to a group.
- [ ] Build `SettingsHome` with the account card, search, and seven group cards.
- [ ] Extract the existing `SettingsScreen` rows into group pages.
- [ ] Add `SettingsSearch` across groups, rows, and keywords.
- [ ] Add breadcrumbs and exact deep links.
- [ ] Add `SpireSettings` (account, plan/usage, Live, Ask behaviour, visibility).
- [ ] Add `FloatingOrbSettings` (preview, size, opacity, snap, test, reset, explainer).
- [ ] Rename the UI to “Floating Orb”; keep preference keys.
- [ ] Add the system orb visual spec and accessible popup fallback.
- [ ] Verify every old setting is reachable and searchable.
- [ ] Verify TalkBack on the settings home, groups, and orb preview.

### 6.3 Phase 3 implementation checklist

- [ ] Extend `/api/spire` with `recent`, `cursor`, `limit`, `kind`, `source`.
- [ ] Add `SpireLibraryRepository.recent(...)` and tests.
- [ ] Build `LibraryScreen` with loading, empty, error, filters, search, pagination.
- [ ] Open chats/artifacts in Spire immersive; back returns to Library.
- [ ] Add `/api/chat/export` and native “Export chat”.
- [ ] Add delete chat/artifact with confirmation.
- [ ] Add share.
- [ ] Add native plan/usage card in Settings.
- [ ] Add account status and sign-in/sign-out.
- [ ] Only now enable `SPIRE_IMMERSIVE` by default (with the web header hidden).
- [ ] Verify export/delete/history parity before flipping the flag.

### 6.4 Phase 4 implementation checklist

- [ ] Build `ToolsScreen` with categories and enabled/disabled states.
- [ ] Map each tool to its existing `ToolSettingId` / alias.
- [ ] Tapping a calculate/discover tool switches to Search with the tool mode active.
- [ ] Tapping reminders/notes/alarms opens the existing native form.
- [ ] Add “Customise” → Settings → Tools.
- [ ] Add the optional “Create with Spire” card.
- [ ] Verify disabled tools do not launch.
- [ ] Verify back from Tools returns to Search.

### 6.5 Phase 5–6 implementation checklist

- [ ] NavigationRail at ≥600 dp; bottom dock below.
- [ ] Landscape, foldable, multi-window.
- [ ] RTL, 200% font scale, reduced motion, high contrast.
- [ ] Predictive back on Android 13+.
- [ ] Process-death restoration.
- [ ] Performance budgets.
- [ ] Security review.
- [ ] All 16 locales.
- [ ] `scripts/verify.sh` passes.
- [ ] Pre-launch report clean.
- [ ] Rollback drill.

---

## 7. Test plan

### 7.1 Automated

- Unit: `NavigationState` reducer, back rules, tab restoration, settings group mapping, feature-flag fallbacks, floating orb visibility.
- Compose UI: dock visibility, tab selection, labels, IME hide/show, RTL, font scale, Settings search, Library states, Tools states.
- Instrumented: WebView back bridge, artifact close, share/deep link, process death, predictive back.
- Screenshot tests for dock/orb in light/dark/AMOLED/wallpaper.
- String parity and lint.

### 7.2 Manual matrix

| Dimension | Values |
|---|---|
| Android | 7.0, 10, 13, 15/16 |
| Navigation | gesture, 2-button, 3-button |
| Display | phone, small phone, tablet, foldable, landscape, multi-window |
| Theme | light, dark, AMOLED, Material You, wallpaper, custom accent |
| Text | 100%, 150%, 200%, RTL |
| Accessibility | TalkBack, switch access, reduced motion, high contrast |
| OEM | Pixel, Samsung, Xiaomi, OnePlus |
| Modes | normal, launcher, overlay, share, assistant, App Link |
| Floating orb | enabled/disabled, accessibility on/off, hidden-until-unlock, rotation, process death |

### 7.3 Acceptance criteria

1. Dock appears on Search, Library, Tools, Settings; hidden in Spire, settings detail, onboarding, overlay, and IME.
2. Spire opens from the orb, search row, library item, share, deep link, Quick Ask, and Live.
3. Spire back closes artifact/modal → WebView back → origin tab.
4. WebView does not reload when switching tabs; streaming survives.
5. No duplicate navigation bars; no overlapping search bar/dock.
6. Every old setting is reachable in the new settings home; search finds it.
7. Floating orb tap/long-press/drag/drop/hide all work; it never appears inside the app or over Spire.
8. TalkBack can reach and operate every tab, orb, and settings row.
9. Tablet uses a rail; phone uses the dock; both preserve state.
10. All tests pass; no new crashes/ANRs in pre-launch.

### 7.4 Rollout and rollback

- Feature flags per surface.
- Staged rollout as above.
- Monitor Play Console vitals, support tickets, uninstall rate, and startup time.
- Rollback triggers: crash-free < 99.5%, ANR > 0.5%, startup +20%, Spire open rate −10%, or a reproducible back-navigation bug.
- Keep the old navigation code path for one release cycle.

---

## 8. Production readiness gates

Do not ship until all are true:

### Functional
- [ ] All tabs and states work.
- [ ] Spire immersive parity is complete.
- [ ] Every setting is reachable.
- [ ] Floating orb works in all modes.
- [ ] Deep links, share, App Links, assistant, launcher, overlay all work.

### UX
- [ ] No duplicate nav or overlapping bars.
- [ ] Back behaviour matches §4.4.
- [ ] No dead ends.
- [ ] Empty/loading/error states for Library and Tools.
- [ ] Onboarding tip for the dock and orb.

### Accessibility
- [ ] TalkBack pass.
- [ ] 48 dp targets.
- [ ] 200% font scale.
- [ ] RTL pass.
- [ ] Reduced motion pass.
- [ ] Contrast pass.

### Performance
- [ ] Startup budget.
- [ ] Tab switch budget.
- [ ] Spire open budget.
- [ ] Memory budget.
- [ ] No WebView reload.
- [ ] No ANR.

### Security
- [ ] WebView allowlist.
- [ ] Bridge origin review.
- [ ] Overlay privacy review.
- [ ] Device-action confirmations.

### Localization
- [ ] All 16 locales.
- [ ] String parity test.
- [ ] No hardcoded strings.

### Quality
- [ ] `scripts/verify.sh` passes.
- [ ] Unit/Compose/instrumented tests pass.
- [ ] Pre-launch report clean.
- [ ] Rollback drill passed.

---

## 9. Brutal review: what will go wrong if this is rushed

| # | Risk | Why it matters | Mitigation | Ship blocker? |
|---|---|---|---|---|
| 1 | Back exits Spire while an artifact is open | Users lose their work; feels broken | JS back bridge with `setBackConsumes`; test every overlay | Yes |
| 2 | WebView reloads on tab switch | Loses streaming and scroll; feels slow | Keep one `ChatWebViewStore`; never recreate on tab change | Yes |
| 3 | Dock and bottom search bar collide | Cramped, unusable on small phones | One inset owner; hide dock on IME; test 320 dp | Yes |
| 4 | Floating orb appears inside the app | Two Spire buttons; visual noise | Keep `setAppVisible` wired to the new shell; hide in Spire | Yes |
| 5 | Settings deep links break | Existing intents use `SettingsDetailType.valueOf` | Keep enum names; add group mapping; test every intent | Yes |
| 6 | Overlay mode shows the dock | Overlay is a single search field; dock breaks it | Do not render the dock in `OverlayActivity` | Yes |
| 7 | Launcher mode dock covers the wallpaper/gesture area | Breaks the home surface | Optional dock in launcher mode; test gesture nav | Yes |
| 8 | Tablet gets a stretched phone dock | Looks amateur; wastes space | NavigationRail at ≥600 dp | Yes |
| 9 | TalkBack cannot reach the orb/fan | Accessibility failure | Standard accessible popup; custom actions; test | Yes |
| 10 | Settings state machine becomes unmaintainable | Bugs multiply | Pure reducer + group layer; unit tests | Yes |
| 11 | 16 locales missing strings | Build/test failure | `add_strings.py`; parity test | Yes |
| 12 | Immersive mode removes export/delete/history | Users lose features | Phase 3 parity before default; keep header flag | Yes |
| 13 | Predictive back janks | Feels broken on Android 14+ | Synchronous back flag; test predictive back | No, but fix before 100% |
| 14 | Low-end devices drop frames | Bad first impression | Simple transitions; no blur on old Android; reduced motion | No, but gate |
| 15 | No analytics means no proof | Can’t measure success | Play Console + debug counters + beta survey | No, but define metrics |
| 16 | Scope creep across five projects | Nothing ships | Phase gates and feature flags | Yes |
| 17 | Two different Spire orb designs | Brand inconsistency | Shared `SpireOrbSpec` and drawable | No, but fix |
| 18 | Process death resets tab/Spire | Confusing | `rememberSaveable` + state restoration tests | No, but gate |

### The three things I would not compromise on

1. **Back correctness.** A chat app that exits at the wrong time is worse than no redesign.
2. **One WebView.** Reloading or duplicating the WebView will destroy streaming and memory.
3. **Parity before immersion.** Do not hide the web header until Library/export/account/usage replace it.

---

## 10. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | 4 tabs + centre orb vs 5 tabs | **4 tabs + orb.** Five tabs plus an orb is crowded. |
| 2 | Spire as a tab vs an orb action | **Orb action.** It keeps Spire immersive and gives it prominence. |
| 3 | Native Library vs web Library in a WebView | **Native Library.** A WebView tab would hide the dock and defeat the tab model. |
| 4 | Tools as a tab vs a Search section | **Tab for discoverability.** Tools can launch existing search modes. |
| 5 | Bottom search bar + dock | **Coexist**, dock hides on IME; default top for new installs. |
| 6 | Dock in launcher mode | **Optional**, default on; add “Clean Home” toggle. |
| 7 | Web header in immersive mode | **Hide only after Phase 3 parity**; feature flag until then. |
| 8 | System orb: accessibility overlay vs bubbles API | **Keep accessibility overlay.** It already supports drag/drop and OEMs. |
| 9 | Analytics | **No tracking.** Use Play Console + debug-only counters + beta feedback. |
| 10 | Web desktop settings hub | **Phase 2 parity**, not part of the Android critical path. |

---

## 11. Appendix

### A. Settings mapping (old → new)

| Old location | New group |
|---|---|
| Overlay Mode (top card) | Gestures & Access |
| Appearance | Appearance |
| At a Glance | Search (or Appearance? Keep under Search) |
| Search Results | Search |
| Search Engines | Search |
| Tools | Tools |
| AI Provider | Spire & AI |
| Gestures | Gestures & Access |
| More Options | About / Search |
| Launch Options | Gestures & Access |
| Permissions | Data & Privacy |
| App Language | Appearance |
| Backup & Restore | Data & Privacy |
| Release Notes / Features / OSS | About |
| Floating Button | Gestures & Access |

### B. New strings (initial set)

- `nav_search`, `nav_library`, `nav_tools`, `nav_settings`, `nav_spire`
- `nav_spire_new_chat`, `nav_spire_live`, `nav_spire_ask`
- `settings_group_spire_ai`, `settings_group_search`, `settings_group_appearance`, `settings_group_tools`, `settings_group_gestures_access`, `settings_group_data_privacy`, `settings_group_about`
- `settings_search_hint`, `settings_search_empty`
- `library_title`, `library_search_hint`, `library_empty_title`, `library_empty_body`, `library_filter_all`, `library_filter_chats`, `library_filter_images`, `library_filter_pdfs`, `library_filter_sheets`, `library_filter_documents`, `library_filter_audio`, `library_filter_notebooks`, `library_filter_slides`
- `tools_title`, `tools_category_calculate`, `tools_category_organize`, `tools_category_discover`, `tools_category_automate`, `tools_disabled_hint`
- `floating_orb_title`, `floating_orb_desc`, `floating_orb_test`, `floating_orb_reset`, `floating_orb_how_it_works`, `floating_orb_accessibility_disclosure`
- `spire_account_title`, `spire_plan_usage`, `spire_live_settings`, `spire_ask_behavior`, `spire_chat_visibility`
- `spire_export_chat`, `spire_delete_chat`, `spire_delete_artifact`
- `onboarding_dock_tip`, `onboarding_orb_tip`

### C. Wireframes

**Phone**

```
┌──────────────────────────────────────┐
│ Search bar                           │
│                                      │
│  At a Glance                         │
│  Suggestions                         │
│                                      │
│  [ Search ] [ Library ] ( Spire ) [ Tools ] [ Settings ]
│                                      │
└──────────────────────────────────────┘
```

**Spire immersive**

```
┌─────────────────────────────┐
│                             │
│  Conversation               │
│                             │
│  [artifact card]            │
│                             │
│  ┌───────────────────────┐  │
│  │ Ask anything...       │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Tablet**

```
┌────────────┬──────────────────┐
│ Search     │                  │
│ Library    │                  │
│ (Spire)    │     Content      │
│ Tools      │                  │
│ Settings   │                  │
└────────────┴──────────────────┘
```

### D. Implementation order (short)

1. State reducer + tests.
2. Dock + scaffold + Search integration.
3. Spire immersive + back bridge.
4. Settings home/groups/search.
5. Floating orb settings + system overlay redesign.
6. Library + API + export/delete.
7. Tools.
8. Adaptive/accessibility/performance.
9. Localization + verification.
10. Staged rollout.

---

**Bottom line:** the idea is sound, but this is a navigation rewrite, not a theme change. Ship it behind flags, in the order above, and do not hide the web header until the native replacements are real. The dock and the orb are the easy part; back correctness and WebView lifecycle are the hard part.
