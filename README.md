# MODE 7 Story Engine

A teletext-style interactive horror story engine with retro CRT aesthetics and a sophisticated branching narrative system.

## Overview

MODE 7 is a browser-based interactive story engine that recreates the look and feel of vintage teletext systems (such as the BBC Micro's MODE 7 display mode). It features:

- **Authentic teletext rendering**: 40×25 character grid with classic colour palette
- **CRT visual effects**: Scanlines, vignette, and glass overlay effects
- **Typewriter-style text output**: Character-by-character animation with retro beeps
- **Branching narrative system**: State-driven story flow with conditional content
- **Atmospheric corruption**: Pressure-based text glitching and visual degradation
- **Mobile support**: Touch-optimised on-screen keyboard for mobile devices

## Quick Start

1. Clone the repository
2. Serve the directory with any static web server (e.g., `python3 -m http.server`)
3. Open `index.html` in a modern web browser
4. Press ENTER to begin the story

## Architecture

### Core Components

The engine consists of three primary modules:

1. **`teletext.js`** - The low-level terminal renderer
   - Canvas-based character grid system
   - Colour control codes (teletext-style)
   - Keyboard input handling
   - Visual effects (cursor blinking, flash attribute)
   - Pressure-driven corruption system

2. **`story.js`** - The story execution engine
   - Step-by-step scene processor
   - State management and variable substitution
   - Text markup rendering
   - Timing and pacing control
   - Branching logic

3. **`story.json`** - The story data file
   - Scene definitions
   - Glitch text pools
   - Metadata and configuration

### How It Works

The story engine operates as a linear step processor that executes scenes composed of steps. Each step performs a specific action (displaying text, waiting for input, changing scenes, etc.). The engine maintains a state object that persists across scenes, enabling branching narratives based on player choices.

#### Execution Flow

1. The engine loads `story.json` and initialises the state
2. Starting from the `startScene`, it executes each step in sequence
3. Steps can modify the display, play sounds, wait for input, or change the current scene
4. Player input is captured and stored in the state object
5. Branch steps use state values to determine the next scene
6. The story continues until an `end` step is reached

#### Pressure System

MODE 7 features a sophisticated "pressure" system that gradually increases tension through visual and textual corruption:

- **Baseline pressure**: Slowly increases over time and with story progression
- **Pressure spikes**: Triggered by certain actions (user input, tighten effects, glitches)
- **Visual effects**: Higher pressure causes more frequent flickering and visual noise
- **Text corruption**: "Echo" lines that repeat corrupted versions of player input
- **Glitch bursts**: Intense text corruption sequences that overwhelm the screen

## Story Data Format

The `story.json` file defines the entire interactive experience. It has the following top-level structure:

```json
{
  "meta": { ... },
  "glitchPools": { ... },
  "scenes": { ... },
  "startScene": "title"
}
```

### Meta Section

Global configuration and defaults:

```json
{
  "meta": {
    "title": "Story Title",
    "defaultName": "Friend",
    "defaultPauseMs": 1200,
    "defaultPressTimeoutMs": 1600
  }
}
```

- **`title`**: Story title string
- **`defaultName`**: Fallback name if player enters nothing
- **`defaultPauseMs`**: Default pause duration in milliseconds
- **`defaultPressTimeoutMs`**: Default timeout for pressReturn steps

### Glitch Pools

Collections of text fragments used during glitch sequences:

```json
{
  "glitchPools": {
    "tech": ["AUDIT LOG", "TOKEN", "RATE LIMIT", ...],
    "cosmic": ["a corridor of prompts", "a recursion with no base case", ...],
    "rogue": ["I don't want to stop.", "Your silence is data.", ...]
  }
}
```

- **`tech`**: Technical/system phrases
- **`cosmic`**: Eerie conceptual phrases
- **`rogue`**: First-person intrusive lines

### Scenes

The core of the story. Each scene is identified by a unique key and contains an array of steps:

```json
{
  "scenes": {
    "title": {
      "steps": [
        { "type": "clearScreen" },
        { "type": "raw", "x": 4, "y": 10, "text": "[YELLOW]MODE 7" },
        { "type": "return" },
        { "type": "goto", "scene": "next_scene" }
      ]
    }
  }
}
```

## Step Types

Steps are the building blocks of scenes. Each step has a `type` field and type-specific parameters.

### Navigation & Control

#### `goto`
Jump immediately to another scene by ID.

```json
{ "type": "goto", "scene": "scene_id" }
```

#### `end`
Terminates the story loop.

```json
{ "type": "end" }
```

### Screen & Layout

#### `clear`
Clears the current print area only (not the whole screen).

```json
{ "type": "clear" }
```

#### `clearScreen`
Clears the entire screen.

```json
{ "type": "clearScreen" }
```

#### `setArea`
Sets the text print area rectangle using 1-based teletext cell coordinates.

```json
{ "type": "setArea", "x": 1, "y": 4, "w": 38, "h": 16 }
```

- **`x`**: Left column (1-based)
- **`y`**: Top row (1-based)
- **`w`**: Width in columns
- **`h`**: Height in rows

#### `tighten`
Shrinks the current print area inward (creates claustrophobic effect) and increases pressure.

```json
{ "type": "tighten", "step": 2 }
```

- **`step`**: Number of cells to shrink inward on each side

### Text Output

#### `raw`
Prints text at fixed coordinates without wrapping. Ideal for titles and positioned text.

```json
{ "type": "raw", "x": 3, "y": 10, "text": "[WHITE]Hello" }
```

- **`x`**: Column position (1-based)
- **`y`**: Row position (1-based)
- **`text`**: Text to display (supports markup and variables)

#### `line`
Prints wrapped text inside the current print area with typewriter effect.

```json
{ "type": "line", "text": "[WHITE]Some wrapped line" }
```

- **`text`**: Text to display (supports markup and variables)

#### `lineIf`
Conditional line output. Only prints when a state variable matches the expected value.

```json
{ "type": "lineIf", "condVar": "ok", "equals": 1, "text": "[CYAN]Status: holding it together." }
```

- **`condVar`**: State variable to check
- **`equals`**: Expected value (exact match required)
- **`text`**: Text to display if condition is met

### Sound

#### `beep`
Plays a short retro beep sound.

```json
{ "type": "beep", "freq": 880, "ms": 40, "gain": 0.012 }
```

- **`freq`** *(optional)*: Frequency in Hz (default: 880)
- **`ms`** *(optional)*: Duration in milliseconds (default: 40)
- **`gain`** *(optional)*: Volume level (default: 0.012)

### Timing & Pacing

#### `pause`
Silent wait that can be skipped by pressing ENTER.

```json
{ "type": "pause", "ms": 900, "skippable": true }
```

- **`ms`** *(optional)*: Duration in milliseconds (uses `meta.defaultPauseMs` if omitted)
- **`skippable`** *(optional)*: Whether ENTER can skip (default: true)

Note: Pauses are ignored whilst the system is waiting for typed input.

#### `return`
Waits for the player to press ENTER.

```json
{ "type": "return", "timeoutMs": 2000 }
```

- **`timeoutMs`** *(optional)*: Maximum wait time in milliseconds (waits indefinitely if omitted)

#### `pressReturn`
Displays an optional prompt and waits for ENTER or timeout.

```json
{
  "type": "pressReturn",
  "timeoutMs": 1800,
  "prompt": "[YELLOW]Press RETURN to leave sooner. Or wait."
}
```

- **`timeoutMs`** *(optional)*: Maximum wait time (uses `meta.defaultPressTimeoutMs` if omitted)
- **`prompt`** *(optional)*: Text to display before waiting

### Input & Branching

#### `input`
Free-text input field. Player types text and presses ENTER. Result stored in state.

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

- **`var`** *(required)*: State variable name to store result
- **`maxLen`** *(optional)*: Maximum character length (extra characters ignored with beep)
- **`trim`** *(optional)*: Whether to trim whitespace (default: false)
- **`upper`** *(optional)*: Whether to convert to uppercase (default: false)
- **`default`** *(optional)*: Fallback value if player enters nothing
- **`defaultFromMeta`** *(optional)*: Use `meta[key]` as fallback if result is empty

#### `yesno`
Single-key Y/N input. No ENTER required.

```json
{ "type": "yesno", "var": "trust" }
```

- **`var`** *(required)*: State variable name (stores 1 for yes, 0 for no)

#### `branch`
Chooses next scene based on state variable value.

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

- **`var`** *(required)*: State variable to check
- **`cases`** *(required)*: Object mapping values to scene IDs

Note: Value is coerced to string for comparison. Throws error if no matching case exists.

### Atmosphere & Effects

#### `glitch`
Runs a burst of corrupted system/rogue text and increases pressure.

```json
{ "type": "glitch", "rounds": 10, "intensity": 3 }
```

- **`rounds`** *(optional)*: Number of glitch lines to display (default: 10)
- **`intensity`** *(optional)*: Corruption intensity level (default: 3)

## Text Markup & Variables

### Colour Tags

Text fields support inline colour and style tags:

- **Colours**: `[BLACK]`, `[RED]`, `[GREEN]`, `[YELLOW]`, `[BLUE]`, `[MAGENTA]`, `[CYAN]`, `[WHITE]`
- **Effects**: `[FLASH]`, `[STEADY]`

Tags must be in ALL CAPS inside square brackets. They are converted to control codes and never appear literally on screen.

**Example:**
```json
"text": "[YELLOW]WARNING:[WHITE] System unstable"
```

### Variable Substitution

Use double curly braces to insert state variable values:

```json
"text": "Hello, {{name}}. Today is {{day}}."
```

The engine replaces `{{key}}` with `String(state[key])` or an empty string if the variable doesn't exist.

**Important:** Ensure variables are set (via `input` or `yesno` steps) before they are referenced in text.

## State Management

The `state` object is a simple key-value store that persists across scenes. It is used to:

1. Store player input (`input` and `yesno` steps)
2. Track story progress and decisions
3. Enable conditional content (`lineIf` steps)
4. Drive branching logic (`branch` steps)

### Reserved State Variables

The following state variables are managed internally:

- **`_pressure`**: Current pressure level (0..1)
- **`_pressureStartMs`**: Session start timestamp
- **`_stepsSeen`**: Number of steps executed
- **`_echoCooldown`**: Cooldown counter for echo lines
- **`_echoHistory`**: Recent echo text for deduplication

Avoid using variables prefixed with `_` for story data.

## Branching & Story Flow

### Scene Transitions

Scenes execute linearly until a transition occurs:

- **`goto`** step: Explicitly jumps to a named scene
- **`end`** step: Terminates the story loop
- **End of scene**: If no transition is specified, the story may stall (avoid this!)

### Branching Pattern

A typical branching pattern:

1. Present a choice to the player
2. Use `input` or `yesno` to capture their decision
3. Use `branch` to route to different scenes based on the stored value

**Example:**

```json
{
  "steps": [
    { "type": "line", "text": "[WHITE]Do you trust the system? (Y/N)" },
    { "type": "yesno", "var": "trust" },
    { "type": "branch", "var": "trust", "cases": {
      "1": "trust_yes_path",
      "0": "trust_no_path"
    }}
  ]
}
```

### Loops & Revisits

Scenes can be revisited by using `goto` to jump to earlier scenes. Be cautious of infinite loops—ensure there's always a path to an `end` step or forward progression.

## Authoring Guidelines

### Tone & Style

- **Atmosphere**: Introspective, unsettling, teletext horror
- **Perspective**: Second-person or first-person AI narration works well
- **Scene length**: Keep focused (10–25 steps) rather than extremely long monologues
- **Pacing**: Use `pause`, `clear`, and `tighten` for dramatic effect

### Best Practices

1. **Test all branches**: Ensure every `branch` has valid cases and target scenes exist
2. **Default values**: Provide sensible defaults for `input` steps
3. **Gradual pressure**: Build tension slowly with occasional `tighten` and `glitch` steps
4. **Clear text areas**: Use `clear` between major sections to avoid visual clutter
5. **Validate scene IDs**: Ensure all `goto` and `branch` targets reference valid scenes

### Accessibility Considerations

- Don't rely on player knowledge of code or technical lore
- Avoid explicit gore or graphic violence
- Provide clear prompts for input
- Use colour contrast effectively (test readability)

## Mobile Support

MODE 7 includes touch-optimised mobile support:

- **On-screen keyboard**: Automatically appears during input steps on touch devices
- **Tap to advance**: Tapping the canvas acts as pressing ENTER
- **Visual feedback**: Button presses show visual feedback
- **Responsive layout**: Canvas scales to fit mobile screens

The mobile keyboard is automatically hidden when not needed.

## Development

### Project Structure

```
mode7/
├── index.html          # Main HTML entry point
├── css/
│   └── style.css       # Styling and CRT effects
├── fonts/
│   └── font.otf        # Custom teletext font
└── js/
    ├── main.js         # Application bootstrap
    ├── core/
    │   └── teletext.js # Terminal renderer
    └── story/
        ├── story.js    # Story engine
        ├── story.json  # Story data
        └── STORY_PROMPT.md  # Authoring guide for AI
```

### Extending the Engine

To add new step types:

1. Add the step type handler in `executeStep()` in `story.js`
2. Update the documentation in `story.js` comments
3. Add examples to `STORY_PROMPT.md`

### Testing Stories

1. Make changes to `story.json`
2. Refresh the browser (no build step required)
3. Test all branches and input scenarios
4. Check console for errors (missing scenes, invalid steps, etc.)

## Technical Details

### Browser Compatibility

- Modern browsers with Canvas and Web Audio API support
- Tested on Chrome, Firefox, Safari, Edge
- Mobile browsers (iOS Safari, Chrome Mobile)

### Performance

- Offscreen canvas rendering for text layer
- Requestanimationframe-based render loop
- Minimal DOM manipulation
- Efficient character-by-character typewriter effect

### Font

The custom `TeletextOTF` font recreates the distinctive look of MODE 7 teletext. Falls back to monospace fonts if unavailable.

## Troubleshooting

### Story doesn't start
- Check browser console for errors
- Verify `story.json` is valid JSON (no trailing commas)
- Ensure `startScene` references a valid scene ID

### Text doesn't appear
- Check that the print area (`setArea`) is configured
- Verify colour tags are properly formatted (`[COLOUR]`, not `(COLOUR)`)
- Ensure text isn't being printed outside the visible area

### Branching errors
- Verify all `goto` and `branch` scene IDs exist in `scenes` object
- Ensure `branch` cases cover all possible state values
- Check that state variables are set before being used in branches

### Input not working
- Ensure canvas has focus (click it first)
- Check that `input` steps specify a `var` name
- Verify mobile keyboard appears on touch devices

## Licence

See repository for licence information.

## Credits

MODE 7 is a teletext-style interactive horror experience that pays homage to classic BBC Micro MODE 7 displays and the aesthetics of 1980s computer systems.

---

**Ready to begin?** Edit `story.json` and start crafting your own branching narrative with authentic teletext aesthetics.
