const QUIET_PERIOD = 100
const MAX_WAIT = 2000

/**
 * Wait for the DOM to settle after an action.
 * Uses MutationObserver to detect when mutations stop for 100ms.
 * Hard cap at 2 seconds to avoid hanging on animations/polling.
 */
export function waitForSettle(): Promise<{ settled: boolean }> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>
    let maxTimer: ReturnType<typeof setTimeout>

    const cleanup = (settled: boolean) => {
      observer.disconnect()
      clearTimeout(quietTimer)
      clearTimeout(maxTimer)
      resolve({ settled })
    }

    const resetQuietTimer = () => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(() => cleanup(true), QUIET_PERIOD)
    }

    const observer = new MutationObserver(() => {
      resetQuietTimer()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })

    // Start the quiet timer immediately — if no mutations happen, settle quickly
    resetQuietTimer()

    // Hard cap: resolve as unsettled after MAX_WAIT
    maxTimer = setTimeout(() => cleanup(false), MAX_WAIT)
  })
}
