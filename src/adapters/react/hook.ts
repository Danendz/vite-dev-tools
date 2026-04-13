/**
 * This code sets up the __REACT_DEVTOOLS_GLOBAL_HOOK__ to intercept
 * React fiber tree commits. It must run BEFORE React loads.
 *
 * Injected by the DevToolsPanel component at mount time.
 */
export const HOOK_SCRIPT = /* js */ `
(function() {
  // If React DevTools is already installed, chain onto it
  var existingHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (existingHook) {
    // Wrap existing onCommitFiberRoot
    var originalOnCommitFiberRoot = existingHook.onCommitFiberRoot;
    existingHook.onCommitFiberRoot = function(rendererID, root, schedulerPriority, didError) {
      if (originalOnCommitFiberRoot) {
        originalOnCommitFiberRoot.call(this, rendererID, root, schedulerPriority, didError);
      }
      // Dispatch custom event for our devtools
      window.dispatchEvent(new CustomEvent('__danendz_devtools_commit__', {
        detail: { rendererID: rendererID, root: root }
      }));
    };
    // Capture renderer reference for overrideProps support
    var originalInject = existingHook.inject;
    if (originalInject) {
      existingHook.inject = function(renderer) {
        window.__DANENDZ_DEVTOOLS_RENDERER__ = renderer;
        return originalInject.call(this, renderer);
      };
    }
    // Also check if renderers were already injected
    if (existingHook.renderers && existingHook.renderers.size > 0) {
      existingHook.renderers.forEach(function(renderer) {
        window.__DANENDZ_DEVTOOLS_RENDERER__ = renderer;
      });
    }
  } else {
    // Create our own hook
    var renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: renderers,
      supportsFiber: true,
      inject: function(renderer) {
        var id = renderers.size + 1;
        renderers.set(id, renderer);
        window.__DANENDZ_DEVTOOLS_RENDERER__ = renderer;
        return id;
      },
      onScheduleFiberRoot: function() {},
      onCommitFiberRoot: function(rendererID, root, schedulerPriority, didError) {
        window.dispatchEvent(new CustomEvent('__danendz_devtools_commit__', {
          detail: { rendererID: rendererID, root: root }
        }));
      },
      onCommitFiberUnmount: function() {},
      onPostCommitFiberRoot: function() {},
      setStrictMode: function() {},
    };
  }
})();
`
