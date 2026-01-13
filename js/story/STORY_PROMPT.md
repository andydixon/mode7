# MODE 7 Story Authoring Prompt

Use this prompt with GPT-5.1 (or any compatible model) to create or extend `story.json` for the MODE 7 teletext poem.

You can paste the entire prompt below into a new chat, then add your own high-level story idea at the end.

---

You are helping me author a branching teletext-style interactive story for a MODE 7 canvas renderer.

The story data lives in a single JSON file called `story.json` with this top-level shape:

```json
{
  "meta": { ... },
  "glitchPools": { ... },
  "scenes": { ... },
  "startScene": "title"
}
```

## 1. Overall structure

- `meta`: global configuration and defaults. Current keys:
  - `title`: story title string.
  - `defaultName`: default player name (used if they enter nothing).
  - `defaultPauseMs`: default pause duration in milliseconds (used when a `pause` step omits `ms`).
  - `defaultPressTimeoutMs`: default timeout in milliseconds for `pressReturn` steps.

- `glitchPools`: text snippets used for glitch bursts:
  - `tech`: array of short technical phrases.
  - `cosmic`: array of eerie conceptual phrases.
  - `rogue`: array of first-person intrusive lines.

- `scenes`: an object keyed by scene id. Each value is:
  ```json
  {
    "steps": [ { "type": "...", ... }, ... ]
  }
  ```

- `startScene`: id of the first scene to run, e.g. `"title"`.

## 2. Step types and what they do

Each scene is a linear list of `steps`. The engine walks them in order until a `goto` or `end` changes control flow.

**Navigation / control**

- `goto`  
  ```json
  { "type": "goto", "scene": "scene_id" }
  ```
  Jump immediately to another scene by id.

- `end`  
  ```json
  { "type": "end" }
  ```
  Terminates the story loop.

**Screen / layout**

- `clear`  
  ```json
  { "type": "clear" }
  ```
  Clears the current print area only.

- `clearScreen`  
  ```json
  { "type": "clearScreen" }
  ```
  Clears the whole screen.

- `setArea`  
  ```json
  { "type": "setArea", "x": 1, "y": 4, "w": 38, "h": 16 }
  ```
  Sets the text print area rectangle (1-based teletext cell coordinates).

- `tighten`  
  ```json
  { "type": "tighten", "step": 2 }
  ```
  Shrinks the current print area inward (visual claustrophobia) and slightly increases an internal "pressure" variable that drives glitches.

**Text output**

- `raw`  
  ```json
  { "type": "raw", "x": 3, "y": 10, "text": "[WHITE]Hello" }
  ```
  Prints `text` at fixed coordinates `x`,`y` without wrapping. Good for titles.

- `line`  
  ```json
  { "type": "line", "text": "[WHITE]Some wrapped line" }
  ```
  Prints a single wrapped line inside the current print area using a typewriter effect.

- `lineIf`  
  ```json
  { "type": "lineIf", "condVar": "ok", "equals": 1, "text": "[CYAN]Status: holding it together." }
  ```
  Like `line`, but only prints when `state[condVar] === equals`.

**Sound**

- `beep`  
  ```json
  { "type": "beep", "freq": 880, "ms": 40, "gain": 0.012 }
  ```
  Plays a short retro beep. All fields are optional; use the existing values as a reference tone.

**Timing / pacing**

- `pause`  
  ```json
  { "type": "pause", "ms": 900, "skippable": true }
  ```
  Waits silently for roughly `ms` milliseconds (or `meta.defaultPauseMs` if omitted). The player can press Enter to skip ahead. Pauses are ignored while the system is waiting for typed input.

- `return`  
  ```json
  { "type": "return", "timeoutMs": 2000 }
  ```
  Waits for the player to press Enter. If `timeoutMs` is omitted, it waits indefinitely. If `timeoutMs` is provided, it waits until Enter or until the timeout elapses.

- `pressReturn`  
  ```json
  {
    "type": "pressReturn",
    "timeoutMs": 1800,
    "prompt": "[YELLOW]Press RETURN to leave sooner. Or wait."
  }
  ```
  Optionally prints a prompt line, then waits for Enter or a timeout. If `timeoutMs` is omitted, it uses `meta.defaultPressTimeoutMs`.

**Input and branching state**

The engine maintains a `state` object (a simple key/value bag) that persists across scenes. Certain steps read from or write to this state.

- `input`  
  ```json
  {
    "type": "input",
    "var": "name",
    "maxLen": 18,
    "trim": true,
    "upper": false,
    "default": "Fallback",
    "defaultFromMeta": "defaultName"
  }
  ```
  Shows an input field and lets the player type free text (finished with Enter). The final value is stored in `state[var]`.

  Behaviour details:
  - `var` (required): key under which the answer is stored in `state`.
  - `maxLen` (optional): max characters. Extra characters are ignored with a tiny beep.
  - `trim` (optional): when true, result is `value.trim()`.
  - `upper` (optional): when true, result is coerced to uppercase.
  - `default` (optional): fallback if the player submits an empty string.
  - `defaultFromMeta` (optional): if provided and the result is empty, uses `meta[defaultFromMeta]`.

- `yesno`  
  ```json
  { "type": "yesno", "var": "trust" }
  ```
  Waits for a single `Y` or `N` keypress (no Enter needed), echoes it on screen, and stores `1` for yes or `0` for no in `state[var]`.

- `branch`  
  ```json
  {
    "type": "branch",
    "var": "trust",
    "cases": {
      "1": "act1_trust_yes",
      "0": "act1_trust_no"
    }
  }
  ```
  Reads `state[var]`, coerces it to a string, and uses it as a key into `cases`. The resulting value must be a valid scene id. If there is no matching key, the engine throws an error.

**Glitch / atmosphere**

- `glitch`  
  ```json
  { "type": "glitch", "rounds": 10, "intensity": 3 }
  ```
  Runs a short burst of corrupted system/rogue lines built from `glitchPools.tech`, `.cosmic`, and `.rogue`, and slightly increases an internal `pressure` value that drives visual and textual corruption.

## 3. Markup and variables inside text

Any `text` field can contain:

- **Colour / style tags** like `[WHITE]`, `[CYAN]`, `[MAGENTA]`, `[RED]`, `[GREEN]`, `[YELLOW]`, `[BLUE]`, `[BLACK]`, `[FLASH]`, `[STEADY]`.
  - These must be in all caps and inside square brackets, e.g. `[CYAN]`.
  - They are converted into internal control codes; they should never appear literally on screen.

- **Variable substitutions** like `{{name}}`, `{{day}}`, `{{want}}`.
  - The engine replaces `{{key}}` with `String(state[key])` or an empty string if missing.

When generating `text`, you **may** include new state variables (e.g. `{{secret}}`), but you must also ensure they are actually set by an `input` or `yesno` step before they are used.

## 4. Branching rules and safety

- Each scene executes steps in order until:
  - It hits a `goto` (which sets the next scene id and stops processing that scene), or
  - It hits `end` (which stops the entire story).

- Branching is always explicit through `branch` steps; there is no implicit fallthrough between scenes.

- Loops are allowed (e.g. replay scenes), but avoid creating infinite loops with no clear exit.

## 5. Authoring guidelines and tone

- Tone: introspective, unsettling, teletext horror. Second person or first-person-AI narration is fine.
- Length: aim to keep each scene focused (10–25 steps) rather than extremely long monologues.
- Visuals: use `tighten`, `clear`, and `clearScreen` for pacing and claustrophobic effects.
- Glitch: use `glitch` sparingly but meaningfully as pressure builds.
- Accessibility:
  - Do not rely on player knowledge of code or deep lore.
  - Avoid explicit gore or graphic violence.

## 6. What you should output

When I ask you to CREATE or EXTEND the story, you must:

1. **Output only valid JSON** for `story.json` — no comments, no trailing commas, no extra prose.
2. Preserve existing keys and structure unless I explicitly say we are starting from scratch.
3. When extending, read the current `story.json` I provide and:
   - Reuse the existing `meta` and `glitchPools` unless I ask otherwise.
   - Add new scenes under `scenes` without renaming or deleting existing ones.
   - Ensure all `goto` and `branch` targets refer to valid scene ids.
4. Validate that every new scene id is used somewhere (either as a `goto` or a `branch` target) or clearly reachable from `startScene`.
5. Keep `startScene` unchanged unless I explicitly ask to change it.

## 7. How to respond to me

When I give you an updated or partial `story.json`:

- If I say: "Extend the story with a new act about X":
  - Add new scenes (e.g. `"act7_new_thing"`) and wire them in using `goto`/`branch` from an existing scene.
  - Maintain the existing tone and motifs.

- If I say: "Add a new branch after scene Y when condition Z":
  - Introduce or reuse a `yesno` or `input` step to capture the decision.
  - Store the outcome in `state` via `var`.
  - Add a `branch` step that routes to new or existing scenes based on that state.

Always return the full updated JSON document, not a patch.

---

Now I will provide my current `story.json` (or parts of it) and instructions on how I want it extended.

[Describe here what you want to change or add to the story: new acts, branches, themes, or tone shifts.]
