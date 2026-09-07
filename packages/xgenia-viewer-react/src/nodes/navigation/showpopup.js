const ShowPopupNode = {
  name: 'NavigationShowPopup',
  displayNodeName: 'Show Popup',
  category: 'Navigation',
  docs: 'https://docsapp.xgenia.com/nodes/popups/show-popup',
  initialize: function () {
    this._internal.popupParams = {};
    this._internal.closeResults = {};
    // Number of popups this node currently has open. A counter rather than a boolean because
    // `show` can legitimately fire again before the first popup closes (double-click on a
    // settings button), and each open gets its own onClosePopup callback — a plain boolean
    // would be flipped to false by the first close while another popup was still on screen.
    this._internal.openCount = 0;
  },
  inputs: {
    target: {
      type: 'component',
      displayName: 'Target',
      group: 'General',
      set: function (value) {
        this._internal.target = value;
      }
    },
    show: {
      type: 'signal',
      displayName: 'Show',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleShow();
      }
    }
  },
  outputs: {
    Closed: {
      type: 'signal'
    },
    // ─── OBSERVABLE OPEN STATE (2026-07-29, debug export 1785320275289) ──────────────────
    // Before this the node's ONLY output was the `Closed` signal, which made "is the popup
    // open?" unanswerable:
    //   • a signal carries no value, so nothing can read it — an AI probing `Closed` with
    //     expect{} got told the port "does not exist" (it does; it is just unreadable), and
    //     that false failure became a completion blocker;
    //   • `Closed` does not even fire on every close. See `onClosePopup` below: when the popup
    //     is dismissed through a NAMED closeAction the node emits THAT action's signal instead,
    //     so anything listening on `Closed` alone silently misses the close entirely;
    //   • `_internal.hasScheduledShow` is not a substitute — it is true only for the one frame
    //     between the `show` signal and the popup actually opening.
    //
    // `isOpen` is a readable boolean, so open state can be asserted directly
    // (expect{ port: 'isOpen', equals: true }) and wired to drive UI. `Opened` is the signal
    // counterpart to `Closed`, so open/close can be handled symmetrically. Both flip on EVERY
    // path, including named close actions.
    Opened: {
      type: 'signal',
      displayName: 'Opened',
      group: 'Signals'
    },
    isOpen: {
      type: 'boolean',
      displayName: 'Is Open',
      group: 'State',
      getter: function () {
        return this._internal.openCount > 0;
      }
    }
  },
  methods: {
    setPopupParam: function (param, value) {
      this._internal.popupParams[param] = value;
    },
    getCloseResult: function (param) {
      return this._internal.closeResults[param];
    },
    scheduleShow: function () {
      var _this = this;
      var internal = this._internal;
      if (!internal.hasScheduledShow) {
        internal.hasScheduledShow = true;
        this.scheduleAfterInputsHaveUpdated(function () {
          internal.hasScheduledShow = false;
          // show() is async (it awaits context.showPopup). Attach a handler so a failure to
          // open surfaces as a console error instead of an unhandled promise rejection.
          Promise.resolve(_this.show()).catch(function (e) {
            console.error('[NavigationShowPopup] failed to show popup "' + internal.target + '":', e);
          });
        });
      }
    },
    /** Adjust the open counter and publish the new `isOpen` value. */
    _setOpenDelta: function (delta) {
      const next = Math.max(0, (this._internal.openCount || 0) + delta);
      const wasOpen = (this._internal.openCount || 0) > 0;
      const isOpen = next > 0;
      this._internal.openCount = next;
      // Only publish on an actual transition, so stacked popups don't re-emit the same value.
      if (wasOpen !== isOpen) {
        this.flagOutputDirty('isOpen');
      }
    },
    show: async function () {
      if (this._internal.target == undefined) return;

      const group = await this.context.showPopup(this._internal.target, this._internal.popupParams, {
        senderNode: this.nodeScope.componentOwner,
        /**
         * @param {string | undefined} action
         * @param {*} results
         */
        onClosePopup: (action, results) => {
          this._internal.closeResults = results;

          // Before the action branch on purpose: a popup closed through a NAMED closeAction
          // emits that action's signal and NOT `Closed`, so open state has to be cleared here
          // to stay correct on every close path.
          this._setOpenDelta(-1);

          for (const key in results) {
            if (this.hasOutput('closeResult-' + key)) {
              this.flagOutputDirty('closeResult-' + key);
            }
          }

          if (!action) {
            this.sendSignalOnOutput('Closed');
          } else {
            this.sendSignalOnOutput(action);
          }
        }
      });

      // Only report open when the popup really opened. showPopup returns the container group on
      // success and undefined when the runtime has no onShowPopup handler — reporting
      // optimistically here would make `isOpen` claim a popup that never appeared.
      if (group) {
        this._setOpenDelta(1);
        this.sendSignalOnOutput('Opened');
      }
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('popupParam-'))
        return this.registerInput(name, {
          set: this.setPopupParam.bind(this, name.substring('popupParam-'.length))
        });
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('closeResult-'))
        return this.registerOutput(name, {
          getter: this.getCloseResult.bind(this, name.substring('closeResult-'.length))
        });

      if (name.startsWith('closeAction-'))
        return this.registerOutput(name, {
          getter: function () {
            /** No needed for signals */
          }
        });
    }
  }
};

module.exports = {
  node: ShowPopupNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function _managePortsForNode(node) {
      function _updatePorts() {
        var ports = [];

        var targetComponentName = node.parameters['target'];
        if (targetComponentName !== undefined) {
          var c = graphModel.components[targetComponentName];
          if (c) {
            for (var inputName in c.inputPorts) {
              var o = c.inputPorts[inputName];
              ports.push({
                name: 'popupParam-' + inputName,
                displayName: inputName,
                type: o.type || '*',
                plug: 'input',
                group: 'Params'
              });
            }

            for (const _n of c.getNodesWithType('NavigationClosePopup')) {
              if (_n.parameters['closeActions'] !== undefined) {
                _n.parameters['closeActions'].split(',').forEach((a) => {
                  if (ports.find((p) => p.name === a)) return;

                  ports.push({
                    name: 'closeAction-' + a,
                    displayName: a,
                    type: 'signal',
                    plug: 'output',
                    group: 'Close Actions'
                  });
                });
              }

              if (_n.parameters['results'] !== undefined) {
                _n.parameters['results'].split(',').forEach((p) => {
                  ports.push({
                    name: 'closeResult-' + p,
                    displayName: p,
                    type: '*',
                    plug: 'output',
                    group: 'Close Results'
                  });
                });
              }
            }
          }
        }
        context.editorConnection.sendDynamicPorts(node.id, ports);
      }

      function _trackTargetComponent(name) {
        if (name === undefined) return;
        var c = graphModel.components[name];
        if (c === undefined) return;

        c.on('inputPortAdded', _updatePorts);
        c.on('inputPortRemoved', _updatePorts);

        // Also track all close popups for changes
        for (const _n of c.getNodesWithType('NavigationClosePopup')) {
          _n.on('parameterUpdated', _updatePorts);
        }

        // Track close popup added and removed
        c.on('nodeAdded', (_n) => {
          if (_n.type === 'NavigationClosePopup') {
            _n.on('parameterUpdated', _updatePorts);
            _updatePorts();
          }
        });

        c.on('nodeWasRemoved', (_n) => {
          if (_n.type === 'NavigationClosePopup') _updatePorts();
        });
      }

      _updatePorts();
      _trackTargetComponent(node.parameters['target']);

      // Track parameter updated
      node.on('parameterUpdated', function (event) {
        if (event.name === 'target') {
          _updatePorts();
          _trackTargetComponent(node.parameters['target']);
        }
      });
    }

    graphModel.on('editorImportComplete', () => {
      graphModel.on('nodeAdded.NavigationShowPopup', function (node) {
        _managePortsForNode(node);
      });

      for (const node of graphModel.getNodesWithType('NavigationShowPopup')) {
        _managePortsForNode(node);
      }
    });
  }
};
