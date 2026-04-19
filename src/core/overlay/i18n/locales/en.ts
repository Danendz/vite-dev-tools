export default {
  settings: {
    title: 'Settings',
    language: 'Language',
    close: 'Close',
    categories: {
      general: 'General',
      console: 'Console',
      appearance: 'Appearance',
      mcp: 'MCP',
    },
    general: {
      hideLibrary: {
        label: 'Hide library components',
        desc: 'Hide components from node_modules in the tree',
      },
      hideProviders: {
        label: 'Hide providers',
        desc: 'Hide Provider wrapper components',
      },
      showElements: {
        label: 'Show HTML elements',
        desc: 'Show div, span, and other DOM elements in the tree',
      },
      previewBeforeSave: {
        label: 'Preview before saving',
        desc: 'Show a diff preview before persisting edits to source',
      },
      renderCause: {
        label: 'Render-cause attribution',
        desc: 'Label why each component re-renders — props, state, context, or parent cascade. Adds a "Renders" tab with commit history. Opt-in for performance.',
      },
      historyBuffer: {
        label: 'History buffer size',
        desc: 'Maximum number of commits to keep (10–2000)',
      },
      includeValues: {
        label: 'Include value previews',
        desc: 'Capture old → new value snapshots. Uses more memory.',
      },
      editor: {
        label: 'Editor',
        desc: 'Editor for "open in editor" actions.',
        supportedEditors: 'Supported editors',
        autoDetect: 'Auto-detect',
        custom: 'Custom...',
        customLabel: 'Custom editor command',
        placeholder: 'Editor command...',
      },
    },
    console: {
      hideInternals: {
        label: 'Hide library internals',
        desc: 'Strip node_modules and Vite dependency lines from stack traces',
      },
      clearOnReload: {
        label: 'Clear on hot reload',
        desc: 'Automatically clear errors and warnings when files change',
      },
    },
    appearance: {
      fontSize: {
        label: 'Font size',
        desc: 'Adjust the tree and detail panel font size',
      },
    },
    mcp: {
      status: {
        label: 'Status',
        desc: 'MCP server connection status',
        active: 'Active',
        paused: 'Paused',
      },
      enableBridge: {
        label: 'Enable MCP bridge',
        desc: 'Allow AI agents to query page state and drive the overlay',
      },
      showAiActions: {
        label: 'Show AI actions',
        desc: 'Visually distinguish AI-triggered highlights and selections',
      },
      connection: 'Connection',
      copyCommand: 'Copy command',
      copy: 'Copy',
      copied: 'Copied!',
    },
  },

  tabs: {
    inspect: 'Inspect',
    console: 'Console',
    renders: 'Renders',
  },

  toolbar: {
    selectElement: 'Select element',
    clearAiHighlight: 'Clear AI highlight',
    settings: 'Settings',
    dockLeft: 'Dock left',
    dockBottom: 'Dock bottom',
    dockRight: 'Dock right',
    openPopup: 'Open in popup window',
    dockBack: 'Dock back to page',
    close: 'Close',
    toggleDevTools: 'Toggle DevTools',
    focusPopup: 'Focus DevTools popup',
  },

  tree: {
    searchPlaceholder: 'Search...',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    filterErrors: 'Filter errors',
    noComponents: 'No components detected',
    noMatching: 'No matching components',
  },

  detail: {
    selectPrompt: 'Select a component to inspect',
    source: 'Source',
    usedIn: 'Used in',
    copyPath: 'Copy path',
    copyForAi: 'Copy for AI',
    openSource: 'Open source',
    openUsage: 'Open usage',
    clickToToggle: 'Click to toggle',
    doubleClickToEdit: 'Double-click to edit',
    confirm: 'Confirm',
    cancel: 'Cancel',
    // Section titles
    props: 'Props',
    attributes: 'Attributes',
    locals: 'Locals',
    text: 'Text',
    // Error section
    errors: 'Errors',
    warnings: 'Warnings',
    errorsAndWarnings: 'Errors & Warnings',
    err: 'ERR',
    warn: 'WARN',
    stackTrace: 'Stack trace',
    // Persist actions
    persist: 'Persist',
    saveToSource: 'Save to source',
    saving: 'Saving...',
    saved: 'Saved',
    failed: 'Failed',
    undo: 'Undo',
    // Edit validation
    invalidNumber: 'Invalid number',
    invalidJson: 'Invalid JSON',
    // Render cause
    whyRender: 'Why did this render?',
    renderCauses: {
      mount: 'Mounted',
      props: 'Props changed',
      state: 'State changed',
      context: 'Context changed',
      parent: 'Parent re-rendered',
      bailout: 'Skipped (memoized)',
    },
    propsChanged: 'Props changed:',
    stateChanged: 'State changed:',
    effectsReRan: 'Effects re-ran:',
    contextChanged: 'Context changed:',
    // Render history
    recentRenders: 'Recent renders ({count})',
    showAll: 'Show all ({count})',
    lastRenderedOn: 'Last rendered on',
    showHistory: 'show history',
    lastRenderedOnCommit: 'Last actually rendered on commit #{index}.',
    // Memo hints
    memoHintParent: 'No local changes detected — this component re-rendered because its parent did. Consider wrapping it in {code}.',
    memoHintAlready: 'Already wrapped in {code}, but received new prop references. Check if the parent passes inline objects or functions.',
    // Memoization section
    memoization: 'Memoization',
    rendersWasted: 'of renders wasted ({wasted}/{total})',
    memoSuggestion: "This component re-renders when its parent does, but props don't change. Wrapping in {code} would skip these renders.",
    wrapInMemo: 'Wrap in memo()',
    // Dep lint
    depLint: 'Dep Lint',
    depsUnstable: 'deps {deps} change on most renders',
    depsMissing: '{deps} used in body but not in deps',
    depsWasUnstable: 'was unstable, now stable for {count} renders',
    // Slot
    slotIn: 'slot in {name}',
    // Preview modal
    previewLine: 'line {line}',
    apply: 'Apply',
    // Value diff modal
    previous: 'Previous',
    next: 'Next',
    // Prop origin
    fromFile: 'from {file}',
    varName: 'var {name}',
  },

  console: {
    errors: 'Errors',
    warnings: 'Warnings',
    logs: 'Logs',
    clear: 'Clear',
    copyAll: 'Copy All',
    copyForAi: 'Copy for AI',
    emptyState: 'No console entries captured',
  },

  renders: {
    recording: 'Recording',
    paused: 'Paused',
    clear: 'Clear',
    pauseRecording: 'Pause recording',
    resumeRecording: 'Resume recording',
    clearHistory: 'Clear render history',
    searchPlaceholder: 'Search component, prop, hook, context\u2026',
    pinned: 'Pinned: {name}',
    pinComponent: 'Pin to this component',
    emptyWaiting: 'Waiting for commits\u2026',
    emptyPaused: 'Recording paused.',
    emptyNoMatch: 'No commits match the current filters.',
    selectCommit: 'Select a commit in the timeline.',
    commitHeader: 'Commit #{index}',
    commitTooltip: 'Commit {index}: {count} rerenders',
    rerender: 'rerender',
    rerenders: 'rerenders',
    wasted: 'wasted',
    effectDepsChanged: 'Effect deps changed:',
  },
} as const
