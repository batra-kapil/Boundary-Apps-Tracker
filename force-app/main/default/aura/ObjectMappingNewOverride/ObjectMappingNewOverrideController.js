({
    doInit: function (component) {
        var pageRef = component.get("v.pageReference");
        var defaultFieldValues = pageRef && pageRef.state ? pageRef.state.defaultFieldValues : null;

        // force:hasRecordId's v.recordId is reliably populated when a component is placed
        // directly on a Record Page, but that's not this component's context — this is an
        // actionOverride, and it's not certain the same auto-population applies there. Fall back
        // to reading it straight off the page reference (checking both plausible locations),
        // the same way defaultFieldValues above is read.
        var recordId = component.get("v.recordId");
        if (!recordId && pageRef && pageRef.attributes) {
            recordId = pageRef.attributes.recordId;
        }
        if (!recordId && pageRef && pageRef.state) {
            recordId = pageRef.state.recordId;
        }
        if (!recordId) {
            // Last resort, and should be bulletproof: Salesforce's own Edit URL always carries
            // the record Id in the path itself (/lightning/r/<Object>/<Id>/edit), regardless of
            // what the Aura page reference API surfaces in this actionOverride context.
            var pathMatch = window.location.pathname.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})\/edit/);
            if (pathMatch) {
                recordId = pathMatch[1];
            }
        }

        var payload = {
            objectApiName: component.get("v.sObjectName"),
            recordId: recordId,
            defaultFieldValues: defaultFieldValues
        };

        // Markup attribute binding into the child LWC does not work in this actionOverride
        // context (see the .cmp comment) — the resolved data is pushed in with a direct method
        // call instead. Calling creator.initialize() on the same tick as component.find()
        // silently no-ops (the interop layer isn't fully wired to the real component instance
        // yet), so rather than guessing at a delay, the child dispatches a "creatorready" DOM
        // event once it's actually able to accept the call (see objectMappingCreator.js's
        // connectedCallback). The listener is attached as early as possible, straight off the
        // real DOM element, in case the child's lifecycle already ran by the time this handler
        // gets to it — isReady covers that race directly, without depending on the event.
        var creatorCmp = component.find("creator");
        if (!creatorCmp || typeof creatorCmp.initialize !== "function") {
            // The child isn't in the component tree at all, which shouldn't happen for a
            // component declared directly in this wrapper's markup — bail out rather than
            // guessing with retries; the bounded timeout below has no reference to fall back to
            // here either, so there's nothing further to do.
            return;
        }
        var creatorEl = creatorCmp.getElement();

        var initializeCalled = false;
        var callInitialize = function () {
            if (initializeCalled) {
                return;
            }
            initializeCalled = true;
            creatorCmp.initialize(payload);
        };

        if (creatorEl.isReady === true) {
            callInitialize();
        } else {
            creatorEl.addEventListener("creatorready", callInitialize, { once: true });
        }

        // Bounded safety net: if initialize() still hasn't run a few seconds after this handler
        // started — some edge case neither the event nor the isReady check anticipated — don't
        // leave the user looking at a stuck, unexplained form. Tell the LWC to surface its own
        // visible error rather than failing silently.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        window.setTimeout(function () {
            if (initializeCalled) {
                return;
            }
            if (typeof creatorCmp.showInitializationTimeoutError === "function") {
                creatorCmp.showInitializationTimeoutError();
            }
        }, 3000);
    },

    // The nested objectMappingCreator LWC can't close this action panel itself — closing a
    // lightning:actionOverride requires firing the legacy force:closeQuickAction Aura event from
    // the Aura component that's actually the action target, which is this wrapper, not the LWC.
    handleClose: function () {
        var closeAction = $A.get("e.force:closeQuickAction");
        if (closeAction) {
            closeAction.fire();
        }
    }
});
