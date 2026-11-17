# LLD Studio

A local-first IDE for practising **Low-Level Design interviews in Java**. It runs on your machine and opens in your browser.

- **VS Code-style editor**: Monaco with tabs, find/replace, Java formatting, bracket matching, live `javac` error underlines, light/dark themes
- **Real project folders** on disk: create, rename, move (drag & drop), and delete files, folders and Java packages; import a local project; export as .zip
- **Compile & run Java** with your local JDK: separate stdout/stderr, interactive stdin, stack traces, timing, timeout and Stop
- **Toggleable Java autocomplete**: JDK classes and methods (taken from your installed JDK), your project's classes and members, constructors after `new`, auto-imports, parameter hints
- **AI assistant** through your **Claude subscription via Claude Code** (no API key), or the Anthropic or OpenAI API: context-aware reviews (design, SOLID, edge cases), Java/OOP Q&A, and error debugging
- **Clarification Questions mode**: categorised questions and interviewer answers, an **Interviewer Simulation** that answers like a real interviewer without revealing the design, and AI evaluation of missed requirements
- **Pseudocode mode**: highlighted structured pseudocode; AI converts pseudocode to Java (you review before anything is written, and your pseudocode is kept), converts Java to pseudocode, reviews logic, finds missing cases, and compares pseudocode with your implementation
- **Problem workspaces**: 16 sample problems (Parking Lot, Elevator, Splitwise, BookMyShow, Library, Snake & Ladder, Chess, ATM, Food Ordering, Logging Framework, Rate Limiter, Job Scheduler, Amazon Locker, Linux Find, Notification System, Agentic Chatbot), each with requirements, clarifications, pseudocode, design notes (Markdown + Mermaid class diagrams), personal notes, code and AI history

## Requirements

- **Node.js 22.13+** (uses the built-in `node:sqlite`; developed on Node 24)
- **JDK 17+** for compiling and running Java (`javac` and `java`)
  - Ubuntu / WSL: `sudo apt install openjdk-21-jdk`
  - macOS: `brew install openjdk@21`
  - Windows: `winget install EclipseAdoptium.Temurin.21.JDK`
- Optional, for AI features, either:
  - [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` in a terminal). This uses your Claude plan, no API key needed, and is the default.
  - an Anthropic and/or OpenAI API key

## Start

```bash
npm install
npm start
```

`npm start` builds the UI, starts the local server at **http://localhost:4173** and opens your default browser (on WSL it opens the Windows browser). The first launch shows a setup screen that checks Java and lets you add API keys.

Editing, compiling and running Java all work offline. AI features need internet access.

### Development mode

```bash
npm run dev     # API server with auto-reload + Vite dev server with HMR at http://localhost:5173
npm test        # server unit/integration tests
npm run e2e     # API end-to-end workflow against a running server (default http://127.0.0.1:4173)
E2E_PROVIDER=claude-code npm run e2e   # same, including real AI calls through Claude Code
```

## Where things are stored

| What | Where |
| --- | --- |
| Project source files (one folder per problem) | `~/LLD-Studio/workspace/<problem>/` |
| Problems, clarifications, chat history, settings, layout | `~/.lld-studio/lld-studio.db` (SQLite) |
| API keys | `~/.lld-studio/.env` (file mode 600), or environment variables |
| Build output and caches | `~/.lld-studio/builds`, `~/.lld-studio/cache` |

Each project uses a Maven-style layout:

```
parking-lot/
├── src/main/java/
│   ├── models/  services/  strategies/
│   └── Main.java
├── pseudocode/solution.pseudo
├── design.md      # design notes + ```mermaid class diagrams
├── notes.md       # personal notes
└── README.md
```

You can open and edit these folders with any other tool. LLD Studio reloads changed files when you return to its tab, as long as they have no unsaved edits.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | API keys; these take precedence over keys saved in Settings |
| `JAVA_HOME` | JDK to use; a JDK path set in Settings takes precedence |
| `LLD_PORT` | Server port (default 4173) |
| `LLD_WORKSPACE_DIR` | Workspace directory; overrides the setting |
| `LLD_DATA_DIR` | App data directory (default `~/.lld-studio`) |
| `LLD_NO_OPEN=1` | Don't open a browser on start |

## Using it

1. **Pick a problem** from the top bar, or create or import one with the library icon next to it.
2. **Clarify** (`Alt+Q`): write questions by category and record answers. With *Interviewer simulation* on, each new question is answered by the AI interviewer. Use *Suggest*, *Clear enough?* and *Evaluate my questions* to find gaps.
3. **Pseudocode** (`Alt+2`): sketch classes and flows, then use *Generate Java*. A dialog lists the generated files; files that already exist start unchecked.
4. **Implement** (`Alt+1`): use the explorer toolbar or right-click menu to add classes and packages. Autosave runs on every edit.
5. **Run** (`Ctrl+Enter` / `F5`): pick the main class next to Run. While a program runs, type its input in the `stdin>` box.
6. **Review**: in the AI panel, the *Review* menu offers design, SOLID, edge-case and debug actions. Use the paperclip to attach files.

### AI providers

| Provider | Setup | Billing |
| --- | --- | --- |
| **Claude Code** (default) | Install Claude Code and sign in once by running `claude` | Counts against your Claude plan's usage limits |
| Claude API | Anthropic API key in Settings → AI | Pay-per-token API |
| OpenAI API | OpenAI API key in Settings → AI | Pay-per-token API |

Switch providers from the top bar or the AI panel. Settings → AI shows whether Claude Code is found and signed in, and lets you choose its model (empty = Claude Code's default; `opus`, `sonnet`, `haiku` or a full model ID).

With Claude Code, the server runs `claude -p` locally for each request, with tools, MCP servers and settings files disabled and an empty working directory, so it only answers. Earlier messages in the conversation are included in the prompt, so follow-ups have context. `ANTHROPIC_API_KEY` is removed from the CLI's environment so that your subscription is used rather than API billing.

### AI context

Every AI request includes the problem statement and your clarification Q&A. Requests also include:

- **Chat**: the open file (if the checkbox is ticked) and files you attached
- **Review actions** and **Java → Pseudocode**: your project's Java sources
- **Pseudocode actions**: the active pseudocode file
- **Debug**: the last compile or run output

Context is capped at about 120k characters. If a request goes over, a note lists which files were truncated. API keys stay on the local server and are never sent to the browser.

API default models are `claude-opus-5-5` and `gpt-5`. You can change them in Settings → AI. For supported Claude models on the API, the server enables Anthropic's server-side refusal fallback.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+Enter` / `F5` | Compile & run |
| `Shift+F5` | Stop the program |
| `Ctrl+Shift+B` | Compile only |
| `Ctrl+S` | Save now (autosave is always on) |
| `Alt+Shift+F` | Format Java |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Space` | Suggestions |
| `Ctrl+Alt+Space` | Toggle autocomplete |
| `Alt+1` / `Alt+2` / `Alt+3` | Java / Pseudocode / Problem view |
| `Alt+Q` / `Alt+D` / `Alt+N` / `Alt+T` / `Alt+E` | Clarifications / Design notes / Notes / Terminal / Problems |
| `Ctrl+B` / `Ctrl+Alt+B` / `Ctrl+J` | Toggle explorer / AI panel / bottom panel |
| `Alt+I` | Focus AI chat |
| `Alt+W` | Close tab |
| `Ctrl+/` (outside the editor) | Shortcut list |

## Security notes

- **Java code runs as a normal process on your machine.** It is not sandboxed. It runs with your user permissions, with the project folder as its working directory, under a time limit (default 60 s), a heap limit (default 512 MB) and a 2 MB output cap.
- The server listens on `127.0.0.1` only. It rejects requests whose `Host` or `Origin` isn't local, which blocks other websites and DNS-rebinding attacks.
- All file paths are resolved inside the project folder. Traversal (`../`) and symlinks that point outside it are rejected.
- Processes start without a shell, from argument arrays. User input never reaches a shell.

## Architecture

```
server/src
├── index.ts, app.ts              Fastify bootstrap, local-origin guard, static UI, browser launch
├── config.ts                     paths, secrets file, JDK detection
├── services.ts                   wiring + settings
├── db/PersistenceService.ts      SQLite schema/migrations (node:sqlite)
├── fs/FileSystemService.ts       sandboxed file operations
├── projects/ProjectManager.ts    project scaffolding / import
├── problems/                     ProblemManager + sample problems (with hidden interviewer notes)
├── java/CompilationService.ts    javac + diagnostics parsing + main-class discovery
├── java/JavaExecutionService.ts  java process: stdin/stdout/stderr, timeout, kill
├── java/ApiIndex.ts + java-tools/ApiIndexer.java   reflection index of JDK APIs for autocomplete
├── completion/ProjectSymbols.ts  lightweight Java symbol extraction
├── ai/                           AIProvider interface, Claude Code / Anthropic / OpenAI providers, factory, ContextManager, prompts
└── routes/                       REST API, SSE AI streaming, WebSocket run protocol

web/src
├── layout/                       IDELayout, Splitter
├── components/                   TopBar, FileExplorer, CodeEditor, Terminal, AIChatPanel, ClarificationPanel,
│                                 PseudocodeEditor, ProblemWorkspace, DocPanels, Dialogs (settings/problems/setup)
├── editor/                       Monaco setup, shared models + autosave, Java completion, formatter, pseudocode language
└── state/                        zustand store + actions (problem switching, run service, live checks)
```

The frontend never calls AI providers directly. It talks to `/api/ai/chat`, and the server selects a provider through `AIProviderFactory`.

**Autocomplete design.** Autocomplete is built in, not powered by a full language server. The JDK API index is generated once per JDK by running `ApiIndexer.java` (reflection over about 180 common classes). Project symbols come from a brace-aware extractor. Completion resolves variable types, generic type arguments (`List<Ticket> t; t.get(0).` completes `Ticket` members) and simple call chains. Toggling autocomplete registers or unregisters only the completion and signature-help providers, so highlighting, formatting and diagnostics are unaffected. Eclipse JDT LS could be added later as an optional backend for deeper IntelliSense.
