/* teletext.js - MODE 7-ish canvas terminal with CRT-style rendering and key handling */

export class TeletextTerminal { // Export the terminal class
  constructor(canvas, opts = {}) { // Build a new terminal
    this.canvas = canvas; // Store canvas ref
    this.ctx = this.canvas.getContext("2d", { alpha: false }); // Get 2D context (opaque for speed)

    this.cols = Number(opts.cols ?? 40); // Column count
    this.rows = Number(opts.rows ?? 25); // Row count

    this._fastForward = false; // Whether output is currently fast-forwarding
    this._fastForwardUntil = 0; // Timestamp until fast-forward expires
    this._fastForwardMs = 1200; // How long Enter keeps fast-forward active
    this._fastForwardAnyKey = false; // If true, any key triggers fast-forward (Enter always does)
    this._inputMode = false; // True when the system is waiting for user input (no delays)
    this._skipDelays = false; // True when we want instant output temporarily

    this.scale = Number(opts.scale ?? 2); // Integer-ish scaling for chunky pixels
    this.cellW = Number(opts.cellW ?? 8) * this.scale; // Cell width in pixels
    this.cellH = Number(opts.cellH ?? 12) * this.scale; // Cell height in pixels
    this.padX = Number(opts.padX ?? 8) * this.scale; // Padding X
    this.padY = Number(opts.padY ?? 8) * this.scale; // Padding Y
    this.fontFamily = String(opts.fontFamily ?? '"TeletextOTF", "Courier New", ui-monospace, monospace'); // Prefer the custom OTF, then fall back
    this._busy = false; // True while the terminal is actively “typing” output
    this._cursorEnabled = true; // Whether to draw the cursor
    this._cursorOn = true; // Current blink state
    this._cursorBlinkMs = 420; // Cursor blink period
    this._cursorLastToggle = performance.now(); // Cursor blink timer base

    this.fontSize = Number(opts.fontSize ?? (12 * this.scale)); // Font size scaled to cells
    this.fontWeight = String(opts.fontWeight ?? "700"); // Heavier to feel teletext-y

    this.canvas.width = this.padX * 2 + this.cols * this.cellW; // Set internal pixel width
    this.canvas.height = this.padY * 2 + this.rows * this.cellH; // Set internal pixel height

    this.bg = String(opts.bg ?? "#000000"); // Background colour
    this.defaultFg = String(opts.defaultFg ?? "#FFFFFF"); // Default foreground colour

    this.palette = { // Teletext-like palette
      BLACK: "#000000",
      RED: "#FF3B30",
      GREEN: "#34C759",
      YELLOW: "#FFCC00",
      BLUE: "#0A84FF",
      MAGENTA: "#FF2D55",
      CYAN: "#5AC8FA",
      WHITE: "#FFFFFF"
    }; // End palette

    this.CC = { // Control code map (encoded as characters 1..10)
      ALPHA_BLACK: 1,
      ALPHA_RED: 2,
      ALPHA_GREEN: 3,
      ALPHA_YELLOW: 4,
      ALPHA_BLUE: 5,
      ALPHA_MAGENTA: 6,
      ALPHA_CYAN: 7,
      ALPHA_WHITE: 8,
      FLASH: 9,
      STEADY: 10
    }; // End CC map

    this.buffer = this._makeBuffer(); // Create screen buffer

    this.cursorX = 0; // Cursor column
    this.cursorY = 0; // Cursor row

    this.area = { x: 1, y: 4, w: 38, h: 16 }; // Default print area
    this.baseArea = { ...this.area }; // Base area for tighten()

    this.curFg = this.defaultFg; // Current foreground colour
    this.curFlash = false; // Flash attribute

    this.flashPhase = true; // Whether flashing chars are visible
    this.flashMs = 520; // Flash period in milliseconds
    this._lastFlashToggle = performance.now(); // Flash timer base

    this._pressure = 0; // Pressure (0..1) for micro-corruption
    this._lastFlickerAt = 0; // Last flicker timestamp

    this._keyQueue = []; // Key event queue
    this._keyWaiters = []; // Promises waiting for a key

    this._audioCtx = null; // AudioContext (lazy)
    this._muted = false; // Mute flag
    this._backdropOn = true; // Backdrop flag

    this._running = false; // Render loop running flag
    this._raf = 0; // requestAnimationFrame id

    this._textLayer = document.createElement("canvas"); // Offscreen text canvas
    this._textCtx = this._textLayer.getContext("2d", { alpha: true }); // Text layer context
    this._textLayer.width = this.canvas.width; // Match dimensions
    this._textLayer.height = this.canvas.height; // Match dimensions

    this._dirtyText = true; // Text layer dirty flag
    this._noiseSeed = 0; // Noise seed

    this._applyFont(); // Apply font settings
    this._bindKeyboard(); // Bind keyboard input
    this.forceRedraw(); // Draw initial state
  } // End constructor

setInputMode(on) { // Enable/disable input mode (no delays when on)
  this._inputMode = Boolean(on); // Store
  this._busy = !this._inputMode; // Cursor psychology: waiting when in input mode
} // End setInputMode

fastForwardNow(ms = 2000) { // Force fast output for a short window
  this._fastForward = true; // Enable fast-forward
  this._fastForwardUntil = Date.now() + Math.max(0, Number(ms) || 0); // Set expiry
} // End fastForwardNow

skipDelaysOnce() { // Skip delays for the next procLINE/pause chunk
  this._skipDelays = true; // Arm one-shot
} // End skipDelaysOnce

flushKeys() { // Clear any queued key events (prevents “typing early” from spilling into input)
  this._keyQueue.length = 0; // Empty the queue in-place
} // End flushKeys

_peekQueuedKey() { // Look at the next queued key without removing it
  return this._keyQueue.length > 0 ? this._keyQueue[0] : null; // Return first key or null
} // End _peekQueuedKey

_consumeQueuedKey() { // Remove and return the next queued key
  return this._keyQueue.length > 0 ? this._keyQueue.shift() : null; // Shift or null
} // End _consumeQueuedKey

_enableFastForward() { // Enable fast-forward mode for a short window
  this._fastForward = true; // Turn fast-forward on
  this._fastForwardUntil = Date.now() + this._fastForwardMs; // Set an expiry timestamp
} // End _enableFastForward

_clearOldAreaOutsideNew(oldArea, newArea) { // Clear cells that were inside oldArea but are outside newArea
  const oldLeft = oldArea.x; // Old left bound
  const oldTop = oldArea.y; // Old top bound
  const oldRight = oldArea.x + oldArea.w - 1; // Old right bound (inclusive)
  const oldBottom = oldArea.y + oldArea.h - 1; // Old bottom bound (inclusive)

  const newLeft = newArea.x; // New left bound
  const newTop = newArea.y; // New top bound
  const newRight = newArea.x + newArea.w - 1; // New right bound (inclusive)
  const newBottom = newArea.y + newArea.h - 1; // New bottom bound (inclusive)

  for (let y = oldTop; y <= oldBottom; y += 1) { // Walk all rows of the old area
    for (let x = oldLeft; x <= oldRight; x += 1) { // Walk all cols of the old area
      const insideNew = (x >= newLeft && x <= newRight && y >= newTop && y <= newBottom); // Test if this cell is inside the new area
      if (insideNew) continue; // Keep anything still inside the new area
      this.buffer[y][x] = { ch: " ", fg: this.defaultFg, flash: false }; // Blank the cell (removes stale text)
    } // End col loop
  } // End row loop

  this.forceRedraw(); // Ensure the cleared ring is visible immediately
} // End _clearOldAreaOutsideNew


  _applyFont() { // Apply current font settings
    this.ctx.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`; // Main font
    this.ctx.textBaseline = "top"; // Cell top alignment
    this._textCtx.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`; // Offscreen font
    this._textCtx.textBaseline = "top"; // Offscreen baseline
  } // End _applyFont

  _makeBuffer() { // Create a 2D array of cells
    const buf = []; // Buffer accumulator
    for (let y = 0; y < this.rows; y += 1) { // For each row
      const row = []; // Build a row
      for (let x = 0; x < this.cols; x += 1) { // For each column
        row.push({ ch: " ", fg: this.defaultFg, flash: false }); // Default cell
      } // End col loop
      buf.push(row); // Push row
    } // End row loop
    return buf; // Return buffer
  } // End _makeBuffer

  T(code) { // Convert a numeric code to a 1-char token
    return String.fromCharCode(code); // Encode code as a character
  } // End T

  start() { // Start the render loop
    if (this._running) return; // Avoid double-start
    this._running = true; // Mark running
this._ensureFontLoaded().then(() => { // Load the font in the background
    this._applyFont(); // Re-apply fonts to both contexts once loaded
    this.forceRedraw(); // Force a re-render using the correct font
  }); // End font load chain
    this._tick(performance.now()); // Kick off
  } // End start

  stop() { // Stop the render loop
    this._running = false; // Mark stopped
    if (this._raf) cancelAnimationFrame(this._raf); // Cancel RAF if present
    this._raf = 0; // Clear id
  } // End stop

  forceRedraw() { // Force a full redraw
    this._dirtyText = true; // Mark text layer dirty
  } // End forceRedraw

  setPressure(p) { // Set pressure (0..1)
    const n = Number(p) || 0; // Normalise number
    this._pressure = Math.max(0, Math.min(1, n)); // Clamp into range
  } // End setPressure

  toggleMute() { // Toggle mute
    this._muted = !this._muted; // Flip
  } // End toggleMute

  toggleBackdrop() { // Toggle backdrop
    this._backdropOn = !this._backdropOn; // Flip
  } // End toggleBackdrop

  setPrintArea(x, y, w, h) { // Set the print area
    this.area = { x, y, w, h }; // Store
    this.baseArea = { x, y, w, h }; // Update base
    this.cursorX = this.area.x; // Reset cursor
    this.cursorY = this.area.y; // Reset cursor
    this.forceRedraw(); // Redraw
  } // End setPrintArea

tighten(step) { // Tighten the print area inward while clearing old text outside the new area
  const s = Math.max(0, Math.min(10, Number(step) || 0)); // Clamp tighten step to a safe range

  const oldArea = { ...this.area }; // Snapshot the current (old) area before changing it

  const bx = this.baseArea.x; // Base x (original area anchor)
  const by = this.baseArea.y; // Base y (original area anchor)
  const bw = this.baseArea.w; // Base width
  const bh = this.baseArea.h; // Base height

  const nx = bx + s; // New x after tightening
  const ny = by + s; // New y after tightening
  const nw = Math.max(10, bw - s * 2); // New width after tightening (minimum so it stays usable)
  const nh = Math.max(6, bh - s * 2); // New height after tightening (minimum so it stays usable)

  const newArea = { x: nx, y: ny, w: nw, h: nh }; // Build the new area object

  this.area = newArea; // Apply the new print area

  this._clearOldAreaOutsideNew(oldArea, newArea); // Clear anything that used to be visible but is now outside the new area

  this.cursorX = this.area.x; // Reset cursor to the new left edge
  this.cursorY = this.area.y; // Reset cursor to the new top edge

  this.forceRedraw(); // Force redraw in case cursor/attributes need repainting
} // End tighten

  procCLEAR() { // Clear only the print area
    for (let y = this.area.y; y < this.area.y + this.area.h; y += 1) { // Rows
      for (let x = this.area.x; x < this.area.x + this.area.w; x += 1) { // Cols
        this.buffer[y][x] = { ch: " ", fg: this.defaultFg, flash: false }; // Blank cell
      } // End cols
    } // End rows
    this.cursorX = this.area.x; // Reset cursor
    this.cursorY = this.area.y; // Reset cursor
    this.curFg = this.defaultFg; // Reset fg
    this.curFlash = false; // Reset flash
    this.forceRedraw(); // Redraw
  } // End procCLEAR

  clearScreen() { // Clear entire screen
    for (let y = 0; y < this.rows; y += 1) { // Rows
      for (let x = 0; x < this.cols; x += 1) { // Cols
        this.buffer[y][x] = { ch: " ", fg: this.defaultFg, flash: false }; // Blank
      } // End cols
    } // End rows
    this.cursorX = 0; // Reset cursor
    this.cursorY = 0; // Reset cursor
    this.curFg = this.defaultFg; // Reset fg
    this.curFlash = false; // Reset flash
    this.forceRedraw(); // Redraw
  } // End clearScreen

  printStreamAt(x, y, text) { // Print a stream at fixed coordinates
    let cx = x; // Local x
    let cy = y; // Local y
    for (let i = 0; i < text.length; i += 1) { // Walk text
      const ch = text[i]; // Current char
      const code = ch.charCodeAt(0); // Char code
      if (this._applyControlCode(code)) continue; // Apply control codes
      if (cx >= 0 && cx < this.cols && cy >= 0 && cy < this.rows) { // Bounds check
        this.buffer[cy][cx] = { ch, fg: this.curFg, flash: this.curFlash }; // Write
      } // End bounds
      cx += 1; // Advance column
      if (cx >= this.cols) { // Wrap screen edge
        cx = 0; // Reset x
        cy += 1; // Next row
        if (cy >= this.rows) break; // Stop if off screen
      } // End wrap
    } // End loop
    this.forceRedraw(); // Redraw
  } // End printStreamAt

  _applyControlCode(code) { // Apply control codes 1..10
    if (code < 1 || code > 10) return false; // Not a control code

    if (code === this.CC.ALPHA_BLACK) this.curFg = this.palette.BLACK; // Set fg
    if (code === this.CC.ALPHA_RED) this.curFg = this.palette.RED; // Set fg
    if (code === this.CC.ALPHA_GREEN) this.curFg = this.palette.GREEN; // Set fg
    if (code === this.CC.ALPHA_YELLOW) this.curFg = this.palette.YELLOW; // Set fg
    if (code === this.CC.ALPHA_BLUE) this.curFg = this.palette.BLUE; // Set fg
    if (code === this.CC.ALPHA_MAGENTA) this.curFg = this.palette.MAGENTA; // Set fg
    if (code === this.CC.ALPHA_CYAN) this.curFg = this.palette.CYAN; // Set fg
    if (code === this.CC.ALPHA_WHITE) this.curFg = this.palette.WHITE; // Set fg

    if (code === this.CC.FLASH) this.curFlash = true; // Flash on
    if (code === this.CC.STEADY) this.curFlash = false; // Flash off

    return true; // Consumed
  } // End _applyControlCode

  _scrollArea() { // Scroll print area up by one row
    const top = this.area.y; // Top row index
    const bottom = this.area.y + this.area.h - 1; // Bottom row index
    const left = this.area.x; // Left col index
    const right = this.area.x + this.area.w - 1; // Right col index

    for (let y = top; y < bottom; y += 1) { // Shift rows
      for (let x = left; x <= right; x += 1) { // Shift columns
        this.buffer[y][x] = this.buffer[y + 1][x]; // Copy from next row
      } // End cols
    } // End rows

    for (let x = left; x <= right; x += 1) { // Clear last row
      this.buffer[bottom][x] = { ch: " ", fg: this.defaultFg, flash: false }; // Blank
    } // End clear row
  } // End _scrollArea

  _ensureCursorInArea() { // Ensure cursor stays within the area
    const maxY = this.area.y + this.area.h - 1; // Maximum allowed row
    if (this.cursorY > maxY) { // If cursor fell below
      this._scrollArea(); // Scroll the area
      this.cursorY = maxY; // Clamp cursor
    } // End condition
  } // End _ensureCursorInArea

  _newlineInArea() { // Move cursor to next line within area
    this.cursorX = this.area.x; // Reset x
    this.cursorY += 1; // Move down
    this._ensureCursorInArea(); // Scroll if needed
  } // End _newlineInArea

  _writeCharAt(x, y, ch, fg = this.curFg, flash = this.curFlash) { // Write a cell without moving cursor
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return; // Bounds guard
    this.buffer[y][x] = { ch, fg, flash }; // Store cell
  } // End _writeCharAt

  _putCharInArea(ch) { // Put one character into print area
    if (this.cursorX >= this.area.x + this.area.w) { // If beyond right edge
      this._newlineInArea(); // Wrap
    } // End wrap
    this._ensureCursorInArea(); // Ensure y
    this._writeCharAt(this.cursorX, this.cursorY, ch); // Write cell
    this.cursorX += 1; // Advance cursor
  } // End _putCharInArea

  _tokeniseForWrap(text) { // Tokenise including control codes
    const out = []; // Tokens
    for (let i = 0; i < text.length; i += 1) { // Walk text
      const ch = text[i]; // Char
      const code = ch.charCodeAt(0); // Code
      if (code >= 1 && code <= 10) out.push({ type: "cc", code }); // Control code token
      else out.push({ type: "ch", ch }); // Printable token
    } // End loop
    return out; // Return
  } // End _tokeniseForWrap

  _visibleWidth(tokens) { // Count only printable tokens
    let w = 0; // Width counter
    for (let i = 0; i < tokens.length; i += 1) { // Loop tokens
      if (tokens[i].type === "ch") w += 1; // Count printable
    } // End loop
    return w; // Return width
  } // End _visibleWidth

  _findLastSpace(tokens) { // Find last space position in tokens
    let idx = -1; // Space index
    for (let i = 0; i < tokens.length; i += 1) { // Walk tokens
      const t = tokens[i]; // Token
      if (t.type === "ch" && t.ch === " ") idx = i; // Record last space
    } // End loop
    return idx; // Return index
  } // End _findLastSpace

  _hardSplitByVisible(tokens, maxWidth) { // Split by printable width
    const head = []; // Head tokens
    const tail = []; // Tail tokens
    let w = 0; // Printable width
    let inHead = true; // Whether we are in head

    for (let i = 0; i < tokens.length; i += 1) { // Walk tokens
      const t = tokens[i]; // Token
      if (inHead) { // In head
        head.push(t); // Add
        if (t.type === "ch") w += 1; // Count printable
        if (w >= maxWidth) inHead = false; // Switch once full
      } else { // In tail
        tail.push(t); // Add
      } // End branch
    } // End loop

    while (tail.length && tail[0].type === "ch" && tail[0].ch === " ") tail.shift(); // Trim leading spaces
    return { head, tail }; // Return pieces
  } // End _hardSplitByVisible

  _wrapTokens(tokens, maxWidth) { // Wrap tokens to width
    const lines = []; // Wrapped lines
    let current = []; // Current line tokens
    let width = 0; // Current printable width
    let lastBreakIdx = -1; // Last space index in current

    const flush = () => { // Push current line
      lines.push(current); // Store current
      current = []; // Reset
      width = 0; // Reset
      lastBreakIdx = -1; // Reset
    }; // End flush

    for (let i = 0; i < tokens.length; i += 1) { // Walk tokens
      const tok = tokens[i]; // Token
      current.push(tok); // Append token

      if (tok.type === "ch") { // Only printable counts
        width += 1; // Increment width
        if (tok.ch === " ") lastBreakIdx = current.length - 1; // Record break point
      } // End printable

      if (width > maxWidth) { // Overflow
        if (lastBreakIdx >= 0) { // If we can break on space
          const head = current.slice(0, lastBreakIdx); // Before space
          const tail = current.slice(lastBreakIdx + 1); // After space
          lines.push(head); // Commit head
          current = tail; // Continue with tail
          width = this._visibleWidth(current); // Recompute width
          lastBreakIdx = this._findLastSpace(current); // Recompute break
        } else { // Hard wrap
          const split = this._hardSplitByVisible(current, maxWidth); // Split
          lines.push(split.head); // Commit head
          current = split.tail; // Continue
          width = this._visibleWidth(current); // Recompute
          lastBreakIdx = this._findLastSpace(current); // Recompute break
        } // End wrap method
      } // End overflow
    } // End loop

    if (current.length) flush(); // Flush last line
    return lines; // Return wrapped lines
  } // End _wrapTokens

  _ease(p) { // Smoothstep ease
    const x = Math.max(0, Math.min(1, p)); // Clamp
    return x * x * (3 - 2 * x); // Smoothstep
  } // End _ease

  _shouldFlickerChar() { // Decide whether to flicker
    const base = 0.00055; // Very low base chance
    const extra = 0.0060 * this._ease(this._pressure); // Pressure-driven chance
    const rate = base + extra; // Final rate

    const now = Date.now(); // Current time
    const minGap = 140 - Math.floor(this._pressure * 70); // Gap shrinks with pressure
    if (now - this._lastFlickerAt < minGap) return false; // Avoid clustering

    return Math.random() < rate; // Roll
  } // End _shouldFlickerChar

  _corruptChar(ch) { // Create a subtle corruption
    const code = ch.charCodeAt(0); // Code point
    if (code < 32 || code > 126) return ch; // Leave non-printable
    const garble = ["░", "▒", "▓", "·", "•"]; // Subtle noise glyphs
    const r = Math.random(); // Selector

    if (/[a-zA-Z]/.test(ch) && r < 0.55) { // Case flip
      return ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(); // Flip
    } // End case flip

    if (r < 0.86) { // Small ASCII nudge
      const delta = Math.random() < 0.5 ? -1 : 1; // +/-1
      const next = code + delta; // Shift
      return next >= 32 && next <= 126 ? String.fromCharCode(next) : ch; // Clamp
    } // End nudge

    return garble[Math.floor(Math.random() * garble.length)]; // Rare garble
  } // End _corruptChar

_drawCursor() { // Draw a cursor that reflects “working” vs “waiting”
  if (!this._cursorEnabled) return; // Respect cursor toggle
  if (!this._cursorOn) return; // Blink off phase

  const x = this.cursorX; // Cursor cell x
  const y = this.cursorY; // Cursor cell y

  if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return; // Bounds guard

  const px = this.padX + x * this.cellW; // Pixel x
  const py = this.padY + y * this.cellH; // Pixel y

  const p = this._pressure ?? 0; // Pressure (0..1)
  const wobble = this._busy ? Math.floor((Math.random() - 0.5) * (1 + p * 1.2)) : 0; // Subtle jitter only when “busy”

  this.ctx.save(); // Save state

  // “Working” cursor: a claustrophobic thin bar that shivers slightly. // Comment
  if (this._busy) { // Busy cursor style
    this.ctx.globalAlpha = 0.55 + p * 0.20; // More intense with pressure
    this.ctx.fillStyle = "#FFFFFF"; // White bar
    this.ctx.fillRect(px + wobble + (this.cellW - Math.max(2, this.scale)) / 2, py + 2, Math.max(2, this.scale), this.cellH - 4); // Vertical bar
  } else { // Waiting cursor style
    // “Waiting” cursor: a solid block at the insertion point. // Comment
    this.ctx.globalAlpha = 0.55 + p * 0.18; // Gentle but visible
    this.ctx.fillStyle = "#FFFFFF"; // Solid white square
    this.ctx.fillRect(px + 1, py + 1, this.cellW - 2, this.cellH - 2); // Filled block
  } // End style

  this.ctx.restore(); // Restore state
} // End _drawCursor

_updateFastForward() { // Disable fast-forward once expired
  if (!this._fastForward) return; // If off, do nothing
  if (Date.now() <= this._fastForwardUntil) return; // Still active
  this._fastForward = false; // Expire it
} // End _updateFastForward

async _ensureFontLoaded() { // Ensure the custom font is loaded before first draw
  if (!document.fonts || !document.fonts.load) return; // If Font Loading API not supported, skip
  const spec = `${this.fontWeight} ${this.fontSize}px TeletextOTF`; // Build a CSS font spec for the loader
  try { // Attempt a font load
    await document.fonts.load(spec, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"); // Load with a representative sample
    await document.fonts.ready; // Wait until the browser reports fonts ready
  } catch (_) { // If it fails
    // We silently fall back to monospace; no crash. // Comment
  } // End try/catch
} // End _ensureFontLoaded


  async _flickerCell(x, y) { // Flicker a printed cell briefly
    const cell = this.buffer[y][x]; // Read current cell
    const orig = cell.ch; // Original char
    const corrupted = this._corruptChar(orig); // Corrupted char
    if (corrupted === orig) return; // No change, skip

    this.buffer[y][x] = { ...cell, ch: corrupted }; // Overwrite briefly
    this.forceRedraw(); // Redraw
    await this._sleep(16 + Math.floor(Math.random() * 34)); // Hold 16..50ms
    this.buffer[y][x] = { ...cell, ch: orig }; // Restore
    this.forceRedraw(); // Redraw
    this._lastFlickerAt = Date.now(); // Record
  } // End _flickerCell

  _sleep(ms) { // Sleep helper
    return new Promise((r) => setTimeout(r, ms)); // Resolve later
  } // End _sleep

  async procLINE(text) { // Print a wrapped line with typewriter pacing
    this._busy = true; // Mark the terminal as “working”
    const tokens = this._tokeniseForWrap(text); // Tokenise input
    const wrapped = this._wrapTokens(tokens, this.area.w); // Wrap to area width
    this._busy = !this._inputMode; // Busy only when not in input mode

    for (let li = 0; li < wrapped.length; li += 1) { // For each wrapped line
      const lineTokens = wrapped[li]; // Tokens in this line

      if (this.cursorX !== this.area.x) this._newlineInArea(); // Ensure we start at left edge

      for (let ti = 0; ti < lineTokens.length; ti += 1) { // For each token
        const tok = lineTokens[ti]; // Token

        if (tok.type === "cc") { // Control code token
          this._applyControlCode(tok.code); // Apply
          continue; // Skip printing
        } // End control code

        const ch = tok.ch; // Printable char
        this._putCharInArea(ch); // Put char
        this.forceRedraw(); // Redraw

        if (this._pressure > 0 && this._shouldFlickerChar()) { // Flicker occasionally
          const fx = this.cursorX - 1; // Cell we just wrote
          const fy = this.cursorY; // Current row
          if (fx >= this.area.x && fx < this.area.x + this.area.w) { // Bounds within area
            await this._flickerCell(fx, fy); // Flicker it
          } // End bounds
        } // End flicker
        this._updateFastForward(); // Refresh fast-forward expiry
        const noDelay = this._inputMode || this._fastForward || this._skipDelays; // Any reason to skip delays
        if (this._skipDelays) this._skipDelays = false; // One-shot consumption

        if (noDelay || this._fastForward) { // If fast-forward or input mode is active
  await this._sleep(0); // Yield only; effectively instant output
} else if (ch === ".") { // Longer pause after full stops
  await this._sleep(250 + Math.floor(Math.random() * 180)); // Sentence beat
  this._putCharInArea(" "); // Insert a space for that old teletext rhythm
} else { // Normal pacing
  await this._sleep(7 + Math.floor(Math.random() * 16)); // Character jitter delay
} // End pacing

      } // End tokens loop

      this._newlineInArea(); // Move to next line after wrapped line
    } // End wrapped lines loop
this._busy = false; // Mark terminal idle again
  } // End procLINE

  async glitchPulse(rounds, intensity, lineBuilder) { // Print glitch lines quickly
    const r = Math.max(1, Number(rounds) || 1); // Clamp rounds
    const it = Math.max(1, Number(intensity) || 1); // Clamp intensity

    for (let i = 0; i < r; i += 1) { // Loop rounds
      let line = String(lineBuilder(i) ?? ""); // Build base line
      line = this._glitchCorruptLine(line, it); // Corrupt the line
      await this.procLINE(this.T(this.CC.ALPHA_MAGENTA) + line); // Print as magenta
      await this._sleep(28 + Math.floor(Math.random() * 55)); // Rapid delay
    } // End loop
  } // End glitchPulse

  _glitchCorruptLine(s, intensity) { // Heavier corruption for glitch bursts
    const garble = ["░", "▒", "▓", "·", "•", "*", "#"]; // Noise pool
    const rate = Math.min(0.22, 0.03 + intensity * 0.02); // Corruption rate
    let out = ""; // Output

    for (let i = 0; i < s.length; i += 1) { // Loop chars
      const ch = s[i]; // Char
      const code = ch.charCodeAt(0); // Code
      if (code < 32) { out += ch; continue; } // Preserve control chars

      if (Math.random() < rate) { // Corrupt sometimes
        if (/[a-zA-Z]/.test(ch) && Math.random() < 0.55) { // Case flip
          out += ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(); // Flip
        } else if (Math.random() < 0.75) { // ASCII nudge
          const c = ch.charCodeAt(0); // Code
          const d = Math.random() < 0.5 ? -1 : 1; // Delta
          const n = c + d; // New code
          out += n >= 32 && n <= 126 ? String.fromCharCode(n) : ch; // Append
        } else { // Garble glyph
          out += garble[Math.floor(Math.random() * garble.length)]; // Noise
        } // End choice
      } else { // No corruption
        out += ch; // Keep
      } // End branch
    } // End loop

    return out; // Return
  } // End _glitchCorruptLine

  async waitForEnterKey() { // Wait until the user presses Enter
    while (true) { // Loop
      const k = await this.nextKey(null); // Wait for key
      if (k && k.type === "enter") return; // Return on enter
    } // End loop
  } // End waitForEnterKey

  async readTextInput(maxLen = 18) { // General input routine (no hidden inputs)
    const startX = this.cursorX; // Field start x
    const startY = this.cursorY; // Field row
this.setInputMode(true); // Enter input mode (no delays)
this._busy = false; // Input is “waiting”, not “working”

    let s = ""; // Buffer
this.flushKeys(); // Drop any buffered “early typing” before input begins
    for (let i = 0; i < maxLen; i += 1) { // Clear field visually
      this._writeCharAt(startX + i, startY, " ", this.curFg, false); // Clear each cell
    } // End clear
    this.forceRedraw(); // Redraw

    // Ensure the cursor appears at the input field start. // Comment
    this.cursorX = startX;
    this.cursorY = startY;

    while (true) { // Key loop
      const k = await this.nextKey(null); // Wait for key
      if (!k) continue; // Ignore null
      if (k.type === "enter") break; // Done

      if (k.type === "backspace") { // Backspace
        if (s.length > 0) { // If there is something to delete
          s = s.slice(0, -1); // Remove last char
          this._writeCharAt(startX + s.length, startY, " ", this.curFg, false); // Clear cell
          this.forceRedraw(); // Redraw
          this.cursorX = startX + s.length; // Move cursor to new insertion point
          this.cursorY = startY;
        } else { // Nothing to delete
          this.beep(220, 18, 0.01); // Tiny beep
        } // End else
        continue; // Continue loop
      } // End backspace

      if (k.type === "char") { // Character typed
        const ch = k.ch; // Character
        const code = ch.charCodeAt(0); // Code
        if (code < 32 || code > 126) { this.beep(200, 18, 0.01); continue; } // Reject non-printable
        if (s.length >= maxLen) { this.beep(200, 18, 0.01); continue; } // Reject overflow

        s += ch; // Append
        this._writeCharAt(startX + (s.length - 1), startY, ch, this.curFg, false); // Draw char
        this.forceRedraw(); // Redraw
        this.cursorX = startX + s.length; // Advance cursor with text
        this.cursorY = startY;
      } // End char
    } // End loop

    this._newlineInArea(); // Move to next line after input
this.setInputMode(false); // Exit input mode after input is captured

    return s; // Return input string
  } // End readTextInput

  async askYesOrNo() { // Yes/No prompt helper
    this.flushKeys(); // Drop any buffered “early typing” before input begins
    this.setInputMode(true); // Enter input mode (no delays)

    const fieldX = this.cursorX; // Where we'll echo the choice
    const fieldY = this.cursorY; // Same row as the prompt

    // Clear a tiny field so a single Y/N can appear cleanly. // Comment
    for (let i = 0; i < 3; i += 1) {
      this._writeCharAt(fieldX + i, fieldY, " ", this.curFg, false);
    }
    this.forceRedraw();

    // Place the cursor at the Y/N field so it follows the choice. // Comment
    this.cursorX = fieldX;
    this.cursorY = fieldY;

    while (true) { // Loop until valid
      const k = await this.nextKey(null); // Wait for a key
      if (!k) continue; // Ignore nulls

      if (k.type === "char") { // Letter typed
        const ch = (k.ch || "").toLowerCase(); // Normalise
        if (ch === "y" || ch === "n") { // Valid answer
          const shown = ch.toUpperCase(); // Echo as upper-case
          this._writeCharAt(fieldX, fieldY, shown, this.curFg, false); // Draw choice
          this.forceRedraw(); // Update display
          this.cursorX = fieldX + 1; // Move cursor just after the answer
          this.cursorY = fieldY;
          this._newlineInArea(); // Move to next line after answer
          this.setInputMode(false); // Exit input mode
          return ch === "y" ? 1 : 0; // Map to 1/0
        }

        this.beep(220, 30, 0.012); // Invalid key
        continue;
      }

      // Ignore Enter / Backspace during Y/N, just beep so it feels responsive. // Comment
      if (k.type === "enter" || k.type === "backspace") {
        this.beep(220, 30, 0.012);
      }
    } // End loop
  } // End askYesOrNo

  // Backwards-compatible wrappers for existing story engine calls. // Comment
  async procRETURN() { // Legacy name: wait for Enter
    return this.waitForEnterKey();
  } // End procRETURN

  async procGPI(maxLen = 18) { // Legacy name: general input
    return this.readTextInput(maxLen);
  } // End procGPI

  async procYESORNO() { // Legacy name: yes/no input
    return this.askYesOrNo();
  } // End procYESORNO

  async nextKey(timeoutMs) { // Return next queued key (optionally timed)
    if (this._keyQueue.length > 0) return this._keyQueue.shift(); // Immediate

    // If no timeout is requested, keep behaviour simple: store a waiter that will
    // be resolved by the next key event pushed via _pushKey.
    if (timeoutMs === null || timeoutMs === undefined) {
      return new Promise((resolve) => {
        this._keyWaiters.push(resolve); // Store resolver
      }); // End promise
    }

    // With a timeout, ensure we do NOT leak stale waiters. We register a waiter
    // that can be removed if the timeout fires first, so that future keypresses
    // are delivered to the current caller instead of long-dead polls.
    return new Promise((resolve) => {
      let settled = false; // Guard so we only settle once

      const waiter = (evt) => { // Waiter invoked by _pushKey
        if (settled) return; // Ignore if already timed out
        settled = true; // Mark settled
        resolve(evt); // Deliver the event
      };

      this._keyWaiters.push(waiter); // Register timed waiter

      setTimeout(() => { // Timeout branch
        if (settled) return; // If already resolved by a key, skip
        settled = true; // Mark settled

        // Remove this waiter so it doesn't soak up future keypresses
        const idx = this._keyWaiters.indexOf(waiter);
        if (idx >= 0) this._keyWaiters.splice(idx, 1); // Drop stale waiter

        resolve(null); // Report timeout
      }, timeoutMs);
    }); // End timed promise
  } // End nextKey

_pushKey(evt) { // Push a key event into the queue or resolve a waiter

if (evt && evt.type === "enter") { // Enter triggers fast-forward
  this._fastForward = true; // Enable fast-forward
  this._fastForwardUntil = Date.now() + this._fastForwardMs; // Set expiry
} // End fast-forward trigger

  if (evt && (evt.type === "enter" || (this._fastForwardAnyKey && (evt.type === "char" || evt.type === "backspace")))) { // If it should fast-forward
    this._enableFastForward(); // Turn on fast-forward silently
  } // End fast-forward trigger

  if (this._keyWaiters.length > 0) { // If someone is waiting for a key
    const r = this._keyWaiters.shift(); // Take the earliest waiter
    r(evt); // Resolve immediately
    return; // Done
  } // End waiter path

  this._keyQueue.push(evt); // Otherwise queue it for later
} // End _pushKey

  _bindKeyboard() { // Bind key events
    window.addEventListener("keydown", (e) => { // Global listener so typing always works
      if (e.key === "Enter") { this._pushKey({ type: "enter" }); e.preventDefault(); return; } // Enter
      if (e.key === "Backspace") { this._pushKey({ type: "backspace" }); e.preventDefault(); return; } // Backspace

      if (typeof e.key === "string" && e.key.length === 1) { // Printable char
        this._pushKey({ type: "char", ch: e.key }); // Queue
        e.preventDefault(); // Prevent browser default
      } // End printable
    }, { passive: false }); // We call preventDefault, so passive must be false
  } // End _bindKeyboard

  beep(freq = 880, ms = 40, gain = 0.012) { // Retro beep
    if (this._muted) return; // Respect mute

    if (!this._audioCtx) { // Lazy-create audio context
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); // Create
    } // End init

    const ctx = this._audioCtx; // Alias
    const osc = ctx.createOscillator(); // Oscillator
    const g = ctx.createGain(); // Gain node

    osc.type = "square"; // Square wave for retro feel
    osc.frequency.value = freq; // Frequency
    g.gain.value = gain; // Volume

    osc.connect(g); // Connect nodes
    g.connect(ctx.destination); // Output

    const now = ctx.currentTime; // Time base
    osc.start(now); // Start
    osc.stop(now + ms / 1000); // Stop
  } // End beep

  _tick(t) { // Render tick
    if (!this._running) return; // Stop if not running

if (t - this._cursorLastToggle >= this._cursorBlinkMs) { // If it is time to blink
  this._cursorOn = !this._cursorOn; // Toggle cursor visibility
  this._cursorLastToggle = t; // Reset timer
} // End cursor blink


    if (t - this._lastFlashToggle >= this.flashMs) { // Flash toggle timer
      this.flashPhase = !this.flashPhase; // Toggle
      this._lastFlashToggle = t; // Reset timer
    } // End flash handling

    this._renderFrame(t); // Draw a frame (includes noise/fizz each frame)

    this._raf = requestAnimationFrame((tt) => this._tick(tt)); // Schedule next
  } // End _tick

  _renderTextLayer() { // Render buffer into offscreen canvas
    const c = this._textCtx; // Alias
    c.clearRect(0, 0, this._textLayer.width, this._textLayer.height); // Clear

    c.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`; // Ensure font
    c.textBaseline = "top"; // Baseline
    c.imageSmoothingEnabled = false; // Crisp

    for (let y = 0; y < this.rows; y += 1) { // Rows
      for (let x = 0; x < this.cols; x += 1) { // Cols
        const cell = this.buffer[y][x]; // Cell
        if (cell.flash && !this.flashPhase) continue; // Skip hidden flash phase
        const px = this.padX + x * this.cellW; // Pixel x
        const py = this.padY + y * this.cellH; // Pixel y

        c.fillStyle = cell.fg; // Set colour

        // Tiny glow/doubling to get that teletext “fizz”. // Note
        c.globalAlpha = 0.20; // Low alpha ghost
        c.fillText(cell.ch, px + 1, py); // Ghost right
        c.fillText(cell.ch, px, py + 1); // Ghost down

        c.globalAlpha = 1.0; // Solid pass
        c.fillText(cell.ch, px, py); // Main char
      } // End cols
    } // End rows

    this._dirtyText = false; // Mark clean
  } // End _renderTextLayer

  _renderFrame(t) { // Render a full CRT frame
    if (this._dirtyText) this._renderTextLayer(); // Refresh text layer when needed

    const c = this.ctx; // Alias
    c.imageSmoothingEnabled = false; // Keep crisp pixels
    c.fillStyle = this._backdropOn ? this.bg : "#0b0d12"; // Backdrop colour
    c.fillRect(0, 0, this.canvas.width, this.canvas.height); // Fill background

    // Slight jitter increases with pressure, but remains subtle. // Note
    const p = this._pressure; // Pressure
    const j = Math.floor((Math.random() - 0.5) * (1 + p * 1.2)); // Jitter in pixels
    const k = Math.floor((Math.random() - 0.5) * (1 + p * 1.2)); // Jitter in pixels

    // Simulated RGB split (very light). // Note
    const split = 1 + Math.floor(p * 1.0); // Split grows slightly with pressure

    c.globalAlpha = 0.22; // Low alpha for colour ghosts
    c.drawImage(this._textLayer, j - split, k, this.canvas.width, this.canvas.height); // Red-ish ghost (via blend)
    c.drawImage(this._textLayer, j + split, k, this.canvas.width, this.canvas.height); // Blue-ish ghost

    c.globalAlpha = 1.0; // Reset alpha
    c.drawImage(this._textLayer, j, k, this.canvas.width, this.canvas.height); // Main layer

    this._drawCursor(); // Draw the cursor on top of everything

    // Add a bit of noise every frame for fizziness. // Note
    this._drawNoise(t); // Noise overlay

    // Light vignette inside the canvas, for extra CRT feel. // Note
    this._drawVignette(); // Vignette overlay
  } // End _renderFrame

  _drawNoise(t) { // Draw animated noise
    const c = this.ctx; // Alias
    const w = this.canvas.width; // Width
    const h = this.canvas.height; // Height

    const p = this._pressure; // Pressure
    const alpha = 0.035 + p * 0.025; // Noise alpha rises slightly with pressure

    const count = 140 + Math.floor(p * 120); // Number of specks
    c.globalAlpha = alpha; // Set noise alpha
    c.fillStyle = "#ffffff"; // White specks

    this._noiseSeed = (this._noiseSeed + 1) % 100000; // Advance seed

    for (let i = 0; i < count; i += 1) { // Draw specks
      const x = (Math.random() * w) | 0; // Random x
      const y = (Math.random() * h) | 0; // Random y
      const s = (Math.random() < 0.92) ? 1 : 2; // Mostly 1px, sometimes 2px
      c.fillRect(x, y, s, s); // Speck
    } // End specks

    // Occasional faint horizontal “tear”. // Note
    if (Math.random() < (0.010 + p * 0.020)) { // Rare at low pressure, more later
      const y = (Math.random() * h) | 0; // Tear y
      c.globalAlpha = 0.06 + p * 0.05; // Tear alpha
      c.fillRect(0, y, w, 1 + ((Math.random() * 2) | 0)); // Tear line
    } // End tear

    c.globalAlpha = 1.0; // Restore alpha
  } // End _drawNoise

  _drawVignette() { // Draw a subtle vignette overlay
    const c = this.ctx; // Alias
    const w = this.canvas.width; // Width
    const h = this.canvas.height; // Height

    const g = c.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.20, w * 0.5, h * 0.5, Math.max(w, h) * 0.75); // Gradient
    g.addColorStop(0, "rgba(0,0,0,0)"); // Centre clear
    g.addColorStop(1, "rgba(0,0,0,0.38)"); // Edges dark
    c.fillStyle = g; // Apply
    c.fillRect(0, 0, w, h); // Draw
  } // End _drawVignette
} // End class
