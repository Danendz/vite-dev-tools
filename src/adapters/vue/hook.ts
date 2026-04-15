/**
 * This code sets up the __VUE_DEVTOOLS_GLOBAL_HOOK__ to intercept
 * Vue 3 app initialization and component updates.
 * It must run BEFORE Vue loads.
 *
 * Injected via transformIndexHtml by the Vite plugin.
 */
export const HOOK_SCRIPT = /* js */ `
(function() {
  var existingHook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  if (existingHook) {
    // Chain onto existing hook (e.g. Vue DevTools extension)
    var originalEmit = existingHook.emit.bind(existingHook);
    existingHook.emit = function(event) {
      var args = Array.prototype.slice.call(arguments);
      originalEmit.apply(null, args);

      if (event === 'app:init') {
        window.__DANENDZ_DEVTOOLS_VUE_APP__ = args[1];
        window.dispatchEvent(new CustomEvent('__danendz_devtools_vue_init__', {
          detail: { app: args[1], version: args[2] }
        }));
      } else if (event === 'component:added' || event === 'component:updated' || event === 'component:removed') {
        window.dispatchEvent(new CustomEvent('__danendz_devtools_vue_update__', {
          detail: { event: event, app: args[1], uid: args[2], parentUid: args[3], instance: args[4] }
        }));
      }
    };
  } else {
    // Create our own hook
    var events = {};
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
      enabled: true,
      appRecords: [],
      apps: [],
      events: events,
      on: function(event, fn) {
        if (!events[event]) events[event] = [];
        events[event].push(fn);
      },
      off: function(event, fn) {
        var fns = events[event];
        if (fns) {
          var i = fns.indexOf(fn);
          if (i > -1) fns.splice(i, 1);
        }
      },
      once: function(event, fn) {
        var self = this;
        var wrapped = function() {
          fn.apply(null, arguments);
          self.off(event, wrapped);
        };
        this.on(event, wrapped);
      },
      emit: function(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var fns = events[event];
        if (fns) fns.slice().forEach(function(fn) { fn.apply(null, args); });

        if (event === 'app:init') {
          window.__DANENDZ_DEVTOOLS_VUE_APP__ = args[0];
          window.dispatchEvent(new CustomEvent('__danendz_devtools_vue_init__', {
            detail: { app: args[0], version: args[1] }
          }));
        } else if (event === 'component:added' || event === 'component:updated' || event === 'component:removed') {
          window.dispatchEvent(new CustomEvent('__danendz_devtools_vue_update__', {
            detail: { event: event, app: args[0], uid: args[1], parentUid: args[2], instance: args[3] }
          }));
        }
      },
    };
  }
})();
`
