# 🎰 XGENIA v3.0.3

The biggest update since 3.0. You can now take a game from idea to a live, real-money release without leaving the editor. Publish has been rebuilt around your XGENIA login, Stake Engine is a full publish destination, and Living Characters bring AI-made, fully rigged animated characters and slot symbols into your games. New users get playable starter games, guided lessons and an AI that talks in plain words. Under the hood, XGENIA moves to Electron 44 with signed updates.

---

## 🌟 Highlights

- 🚀 **Release a game from Publish alone.** Sign in with XGENIA, create the game, deploy its maths, Verify RTP and pack it, all from one screen. Start in the play-money sandbox and switch to real money when you're ready.
- 🎲 **Stake Engine is a publish destination.** Choose it once in Publish. XGENIA builds the frontend and maths for Stake, checks every Stake limit per mode, and fixes what fails with one click.
- 🧙 **Living Characters.** Describe or upload a character and the AI cuts, rigs and animates it, with faces, expressions and game moments (idle, win, tease). Edit it in the new Character Studio and drop it into your game.
- 🍒 **Animated slot symbols.** WILD, SCATTER, bonus and top symbols can be made as rigged symbols with land, win, idle and anticipation clips, and the reels play them.
- 👋 **A friendlier start.** Playable slot, crash and plinko starters, step-by-step lessons, first-use tips, and a chat that answers in plain words.

---

## ✨ New Features

### 🚀 Publish & RGS
- **Sign in with XGENIA.** Publish connects to the XGENIA RGS with your XGENIA account, either in the system browser or by email. If you belong to several studios, it asks which one, and it asks for your authenticator code when you need one.
- **Sandbox, then real money.** New games start on the play-money sandbox. One switch moves a game to real money and keeps its declared RTP.
- **Verify RTP from Publish.** Measures your game's RTP on the RGS. A sandbox run costs one credit.
- **One link, one button.** Publish opens on a plain first screen with named pages. It always shows the signed-in RGS account with a Sign out button, shows the version you're releasing, and links to the game's Versions page.
- **Published games:**
  - play the casino's launched session
  - show the player's RGS wallet as soon as they load
  - send money to the RGS in cents
  - can replay a bet
  - carry a "Made with XGENIA" credit
- **Older games move onto the RGS in one step.** A game whose maths still runs in the browser gets its maths moved to the RGS, and Publish offers to do it.
- **RGS back office** links now point to rgs.xgenia.app, and the editor talks to the production XGENIA RGS.

### 🎲 Stake Engine
- **Build for Stake** creates the frontend and the maths together.
- **Stake readiness:** every Stake check is explained, with **Fix with AI** for the ones that fail.
- **Stake test harness and Book Connector.**
- **Stake shell built in:** rules screen, sound toggle, spacebar to spin, and confirmation for bets above 2×. The AI no longer builds these by hand.
- **One rule set for every layer.** Jobs deploy only the maths that changed, and a game counts as ready only once its payout has been measured.
- **RTP variations:** the AI compares several dial settings on the same books in one job, so tuning RTP is much faster.
- Each character rig in a Stake export points to its own atlas pages.

### 🧙 Living Characters & Character Studio
- **AI characters:** create a character from a description or a picture. The AI splits it into parts, rigs it, draws its expressions and designs every clip. People, creatures, birds and objects are all supported.
- **Re-rig and redraw** a finished character without starting over.
- **Looping objects** such as a flag, a flame or a palm, built as one seamless loop.
- **Character Studio**, with Simple and Advanced modes:
  - Play mode, the game's state machine as a live graph, tap zones and faces per game moment
  - animate mode with a dopesheet, curve editor, onion skin, bone gizmo, IK, physics and path constraints
  - mesh editing, weights, skins and outfits, vector shapes, text with packaged fonts, data binding, and nesting one character inside another
  - Photoshop layers added as parts, and your own pictures placed on a bone
  - an **Animator chat** that edits the open character for you
- **Export** to Spine 4.2 or 4.3 (JSON and `.skel`), MP4, MOV, WebM, GIF, PNG frames, or a web page that plays the character offline. **Spine import** too.
- **pixi.Puppet node:** play characters in your game with tracks, state machines, outfits, data, root motion, tap events, and one character riding another's bone.
- **Slot symbol rigs:** rigged slot symbols with land, win, idle and anticipation clips. Reels take a **Symbol Rigs** input and fire a true land event.

### 🎨 Images & Assets
- **The Assets panel has been rebuilt into a full asset editor.**
- **Image editor:**
  - one-click game-art jobs: variations, poses, matching icons and tileable textures
  - a version history with hold-to-compare
  - a Size control that works with every model
  - Upscale
  - a Model Hub that puts recommended models first
- **Pictures stay linked to the project.** Edits update the game, and every earlier version is kept.
- **Key art** gets its own layout per game, picked from six instead of one template.
- **Music:** songs with lyrics and vocals, or instrumentals.

### 🤖 XGENIA AI
- **XGENIA AI runs on XGENIA's own keys.** You don't need your own API key. Usage is paid in credits (1 credit = €0.25), and you can top up from the panel header.
- **XGENIA picks the model.** **Try harder** switches to a stronger model when you need one, and **Show all tools** brings back the full model picker and a Faster…Smarter thinking slider.
- **Spending limit per request** under Settings → Spending ($3 / $10 / $25 / No limit). The default is $10.
- **Voice input** works with no setup.
- **Plain-words chat:** the answer comes first, and the work folds into a single "Worked through N steps" row. Live thinking shows as one folded row.
- **The AI knows where everything is in the editor.** Ask "where is…?" and it points to the control, even when it sits under More.
- **Release notes** appear in the update dialog and in Settings.

### 👋 Getting started
- **Starter games:** playable slot, crash and plinko games you can create from the lobby and restyle straight away.
- **XGENIA Lessons:** a guided on-screen coach with Ask and Voice on every card.
- **First-use tips** the first time you use a panel or control.
- **A new game opens on the AI.** A typed description starts from a blank canvas.
- **A clearer lobby:** a clear left rail, no black cards, and a More menu that shows each tool's icon.

### ✏️ Editing
- **Edit mode:** working undo and Unity-style scene tools, plus undo/redo in the top bar and a cleaner selection bar.
- **Preview picking:** a click picks the outermost node, and a double-click goes deeper.
- **Reels:** a new spin motion that scrolls and drops like a studio slot.
- **Docs AI chat** in a floating window.
- **Web plugin panels** in the sidebar. Plugins can also download files.
- **Git merges:**
  - conflict detection understands renames
  - merge messages are cleaner
  - unresolved conflicts are listed instead of silently keeping your side

---

## 🚀 Improvements

- ⚡ **Faster node graph.** No more lag when zooming over dense wiring, and no more whole-window pulsing while a game runs.
- 🖼️ **Lighter preview:**
  - the preview stops drawing while a full-window panel covers it
  - preview reloads skip resending the node library
  - AI screenshots no longer make the preview jump
- 🧊 **Runtime safety:** a dependency livelock is quarantined instead of freezing the editor.
- 📁 **Duplicate and Remix** copy the game folder instead of downloading it.
- 🎨 **Project styles and asset records** follow the open project.
- 🔗 **xgenia.com everywhere.** The Discord invite link is fixed too.

---

## 🐛 Bug Fixes

- **The chat panel never answering** after a reload now reloads itself.
- **Preview images** reload when a panel rewrites a project picture.
- **Images picker** always answers instead of timing out.
- **The design capture** works when the preview loses its size.
- **Dropdown and pointer** glitches are fixed.
- **Node selection** in documents is fixed, along with how messages pass between the editor and its panels.
- **Packaging:** a missing `acorn` dependency is fixed.
- **Stake export** no longer oversamples on an RGS that can't, and a duplicate weighting has been removed.
- **RGS sign-in** says "not invited" only when the invitation was actually refused.

---

## 🛠️ Build & Platform

- ⚙️ **Electron 31 → 44.** Remote panels and the preview now run in isolated frames.
- 🔏 **Signed nightly updates**, with an updated release process.
- 🍎 **macOS:** the app asks to restart only once the update has been staged.
- 📦 **Dependency and security updates.**
- 🪟 **Windows code signing is on its way.** This Windows build isn't signed yet, so Windows may show a SmartScreen warning when you install it. Choose **More info → Run anyway** to continue. Our Windows certificate arrives with the next build, and from then on Windows builds will be signed.
