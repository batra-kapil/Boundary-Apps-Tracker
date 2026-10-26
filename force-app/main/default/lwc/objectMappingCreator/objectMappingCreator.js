import { LightningElement, api, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { getRecord } from "lightning/uiRecordApi";
import { getObjectInfo, getPicklistValues } from "lightning/uiObjectInfoApi";
import getTrackableObjects from "@salesforce/apex/SchemaDiscoveryService.getTrackableObjects";
import getFieldsForObject from "@salesforce/apex/SchemaDiscoveryService.getFieldsForObject";
import getBoundaryApplications from "@salesforce/apex/ObjectMappingCreatorController.getBoundaryApplications";
import getObjectMappingForEdit from "@salesforce/apex/ObjectMappingCreatorController.getObjectMappingForEdit";
import createObjectMapping from "@salesforce/apex/ObjectMappingCreatorController.createObjectMapping";
import updateObjectMapping from "@salesforce/apex/ObjectMappingCreatorController.updateObjectMapping";
import createFieldMappings from "@salesforce/apex/FieldMappingCreatorController.createFieldMappings";
import deleteFieldMappings from "@salesforce/apex/FieldMappingCreatorController.deleteFieldMappings";
import OBJECT_MAPPING_OBJECT from "@salesforce/schema/Object_Mapping__c";
import OPERATION_FIELD from "@salesforce/schema/Object_Mapping__c.Operation__c";
import SYNC_FREQUENCY_FIELD from "@salesforce/schema/Object_Mapping__c.Sync_Frequency__c";
import BOUNDARY_APPLICATION_NAME_FIELD from "@salesforce/schema/Boundary_Application__c.Name";

/**
 * Overrides both the "New" and "Edit" actions on Object_Mapping__c (the same Lightning page is
 * configured as both action overrides in Setup, since action overrides require an Aura
 * top-level target — see ObjectMappingNewOverride). Replaces free-text object API name entry
 * with a live, schema-driven picker, and pre-fills the parent Boundary Application when launched
 * from that record's related list. Once an object is known, also offers a multi-select of that
 * object's fields — mapping them one at a time on a separate Field Mapping screen didn't scale
 * for objects with many fields, so saving bulk-creates/deletes Field_Mapping__c records to match
 * the selection, alongside the Object Mapping itself.
 *
 * Edit mode is driven by whether recordId is populated (only true when the Aura wrapper is
 * invoked as the Edit action). Markup attribute binding from the Aura wrapper
 * (ObjectMappingNewOverride) into this LWC's @api properties does not work in this actionOverride
 * context — not even a hardcoded literal attribute value ever arrived. Instead, the Aura wrapper
 * finds this component via aura:id and calls the initialize() method below directly, passing
 * everything as plain method arguments, deferred by one macrotask after the component is found
 * (an immediate same-tick call silently no-ops — the Aura/LWC interop layer isn't fully wired to
 * the real component instance yet at that point). In edit mode, Boundary Application and
 * Salesforce Object are shown read-only rather than as pickers: the master-detail parent can't be
 * reparented at the platform level, and changing the object would invalidate the existing field
 * mappings, which are tied to that object's schema.
 */
export default class ObjectMappingCreator extends NavigationMixin(LightningElement) {
  objectApiName;
  defaultFieldValues;
  recordId;

  hasInitialized = false;
  isEditMode = false;
  boundaryApplicationId;
  isBoundaryApplicationLocked = false;
  boundaryApplicationOptions = [];
  objectOptions = [];
  selectedObjectApiName;
  fieldOptions = [];
  selectedFieldApiNames = [];
  originalFieldApiNames = [];
  fieldMappingIdByApiName = {};
  selectedOperations = [];
  syncFrequency = "";
  lastValidatedDate = "";
  operationOptions = [];
  syncFrequencyOptions = [];
  isSaving = false;
  loadError;

  _isReady = false;

  // The Aura wrapper can't safely call initialize() until this component is actually connected
  // — component.find("creator") can resolve an Aura-side reference to the child before the
  // underlying custom element is wired up, and calling into it that early silently no-ops. This
  // event is the deterministic signal the wrapper waits for instead of guessing at a delay; see
  // ObjectMappingNewOverrideController.js's doInit for the listener side. isReady is exposed as
  // a fallback for the (real, race-prone) case where this event fires before the wrapper gets a
  // chance to attach its listener.
  connectedCallback() {
    this._isReady = true;
    this.dispatchEvent(new CustomEvent("creatorready", { bubbles: true, composed: true }));
  }

  @api
  get isReady() {
    return this._isReady;
  }

  // Called imperatively by the Aura wrapper (component.find("creator").initialize(...)) once it
  // has fully resolved objectApiName/recordId/defaultFieldValues — see the class doc comment for
  // why this replaces markup attribute binding entirely.
  @api
  initialize({ objectApiName, recordId, defaultFieldValues } = {}) {
    if (this.hasInitialized) {
      return;
    }
    this.loadError = undefined;
    this.objectApiName = objectApiName;
    this.defaultFieldValues = defaultFieldValues;
    this.recordId = recordId;
    if (recordId) {
      this.initializeEditMode();
    } else {
      this.initializeCreateMode();
    }
  }

  // Bounded safety net called by the Aura wrapper if initialize() still hasn't run a few seconds
  // after the wrapper's init handler fired — covers whatever edge case the creatorready
  // event/isReady fallback didn't anticipate, so the user sees an explanation instead of a form
  // that's silently stuck.
  @api
  showInitializationTimeoutError() {
    if (this.hasInitialized) {
      return;
    }
    this.loadError = "This form couldn't load in time. Please close and reopen this action, or refresh the page.";
  }

  initializeEditMode() {
    if (this.hasInitialized) {
      return;
    }
    this.hasInitialized = true;
    this.isEditMode = true;
    // Boundary Application can never be reparented (master-detail), and changing the Salesforce
    // Object would invalidate the existing field mappings, so both are read-only in edit mode
    // regardless of how the record was originally created.
    this.isBoundaryApplicationLocked = true;
    this.loadForEdit();
  }

  initializeCreateMode() {
    if (this.hasInitialized) {
      return;
    }
    this.hasInitialized = true;
    this.isEditMode = false;

    const parsed = this.parseDefaultFieldValues(this.defaultFieldValues);
    this.boundaryApplicationId = parsed.Boundary_Application__c;
    // Only lock the Boundary Application when the New action was actually launched from that
    // record's related list. Launched from the Object Mapping tab/list view directly, there's
    // no such context, so the user needs a way to pick one — Boundary_Application__c is a
    // required master-detail field.
    this.isBoundaryApplicationLocked = Boolean(this.boundaryApplicationId);

    getTrackableObjects()
      .then((options) => {
        this.objectOptions = options;
      })
      .catch((error) => {
        this.loadError = this.extractErrorMessage(error);
      });

    if (!this.isBoundaryApplicationLocked) {
      getBoundaryApplications()
        .then((options) => {
          this.boundaryApplicationOptions = options;
        })
        .catch((error) => {
          this.loadError = this.extractErrorMessage(error);
        });
    }
  }

  loadForEdit() {
    getObjectMappingForEdit({ recordId: this.recordId })
      .then((data) => {
        this.boundaryApplicationId = data.boundaryApplicationId;
        this.selectedObjectApiName = data.objectApiName;
        this.selectedOperations = data.operation ? data.operation.split(";") : [];
        this.syncFrequency = data.syncFrequency || "";
        this.lastValidatedDate = data.lastValidatedDate || "";
        this.fieldMappingIdByApiName = data.fieldMappingIdByFieldApiName || {};
        this.originalFieldApiNames = Object.keys(this.fieldMappingIdByApiName);
        this.selectedFieldApiNames = [...this.originalFieldApiNames];

        return getFieldsForObject({ objectApiName: this.selectedObjectApiName });
      })
      .then((options) => {
        this.fieldOptions = options;
      })
      .catch((error) => {
        this.loadError = this.extractErrorMessage(error);
      });
  }

  @wire(getRecord, { recordId: "$boundaryApplicationId", fields: [BOUNDARY_APPLICATION_NAME_FIELD] })
  boundaryApplicationRecord;

  @wire(getObjectInfo, { objectApiName: OBJECT_MAPPING_OBJECT })
  objectMappingInfo;

  @wire(getPicklistValues, {
    recordTypeId: "$objectMappingInfo.data.defaultRecordTypeId",
    fieldApiName: OPERATION_FIELD
  })
  wiredOperationValues({ data }) {
    if (data) {
      this.operationOptions = data.values.map((entry) => ({ label: entry.label, value: entry.value }));
    }
  }

  @wire(getPicklistValues, {
    recordTypeId: "$objectMappingInfo.data.defaultRecordTypeId",
    fieldApiName: SYNC_FREQUENCY_FIELD
  })
  wiredSyncFrequencyValues({ data }) {
    if (data) {
      this.syncFrequencyOptions = data.values.map((entry) => ({ label: entry.label, value: entry.value }));
    }
  }

  get boundaryApplicationName() {
    return this.boundaryApplicationRecord?.data?.fields?.Name?.value;
  }

  get hasBoundaryApplication() {
    return this.isBoundaryApplicationLocked && Boolean(this.boundaryApplicationId);
  }

  get showBoundaryApplicationPicker() {
    return !this.isBoundaryApplicationLocked;
  }

  get showObjectPicker() {
    return !this.isEditMode;
  }

  get isSaveDisabled() {
    return this.isSaving;
  }

  parseDefaultFieldValues(raw) {
    // Salesforce hands this to us as a single semicolon-delimited, URL-encoded string in the
    // form "Field1=Value1;Field2=Value2" when launching from a related list's New button — not
    // as an object/map, and not comma-delimited.
    const result = {};
    if (!raw) {
      return result;
    }
    for (const pair of raw.split(";")) {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const key = pair.substring(0, separatorIndex);
      const value = pair.substring(separatorIndex + 1);
      if (key) {
        result[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    }
    return result;
  }

  handleBoundaryApplicationChange(event) {
    this.boundaryApplicationId = event.detail.value;
  }

  handleObjectChange(event) {
    this.selectedObjectApiName = event.detail.value;
    this.fieldOptions = [];
    this.selectedFieldApiNames = [];

    if (this.selectedObjectApiName) {
      getFieldsForObject({ objectApiName: this.selectedObjectApiName })
        .then((options) => {
          this.fieldOptions = options;
        })
        .catch((error) => {
          this.loadError = this.extractErrorMessage(error);
        });
    }
  }

  handleFieldsChange(event) {
    this.selectedFieldApiNames = event.detail.value;
  }

  handleOperationChange(event) {
    this.selectedOperations = event.detail.value;
  }

  handleSyncFrequencyChange(event) {
    this.syncFrequency = event.detail.value;
  }

  handleLastValidatedDateChange(event) {
    this.lastValidatedDate = event.target.value;
  }

  handleCancel() {
    // Object_Mapping__c's New/Edit actions are object-level actionOverrides, which Salesforce
    // renders as full-page overrides rather than quick-action panels — so there's no panel for
    // force:closeQuickAction (fired by the Aura wrapper on this "close" event, in case this ever
    // does run inside an actual panel) to close. The real fallback is to just navigate away, the
    // same way handleSave already does after a successful save.
    if (this.isEditMode) {
      this.closeAndNavigateToObjectMapping(this.recordId);
      return;
    }

    this.dispatchEvent(new CustomEvent("close"));
    if (this.boundaryApplicationId) {
      this[NavigationMixin.Navigate]({
        type: "standard__recordPage",
        attributes: {
          recordId: this.boundaryApplicationId,
          objectApiName: "Boundary_Application__c",
          actionName: "view"
        }
      });
    } else {
      this[NavigationMixin.Navigate]({
        type: "standard__objectPage",
        attributes: {
          objectApiName: "Object_Mapping__c",
          actionName: "list"
        }
      });
    }
  }

  handleSave() {
    if (!this.boundaryApplicationId) {
      this.showToast("Error", "Choose a Boundary Application before saving.", "error");
      return;
    }
    if (!this.selectedObjectApiName) {
      this.showToast("Error", "Choose a Salesforce object before saving.", "error");
      return;
    }
    if (!this.selectedOperations.length) {
      this.showToast("Error", "Choose at least one Operation before saving.", "error");
      return;
    }
    if (!this.selectedFieldApiNames.length) {
      this.showToast("Error", "Choose at least one field to map before saving.", "error");
      return;
    }
    if (!this.syncFrequency) {
      this.showToast("Error", "Choose a Sync Frequency before saving.", "error");
      return;
    }
    if (!this.lastValidatedDate) {
      this.showToast("Error", "Choose a Last Validated Date before saving.", "error");
      return;
    }

    this.isSaving = true;

    if (this.isEditMode) {
      this.saveEdit();
    } else {
      this.saveCreate();
    }
  }

  saveCreate() {
    const record = {
      Boundary_Application__c: this.boundaryApplicationId,
      Object_API_Name__c: this.selectedObjectApiName,
      Operation__c: this.selectedOperations.join(";"),
      Sync_Frequency__c: this.syncFrequency || null,
      Last_Validated_Date__c: this.lastValidatedDate || null
    };

    let newObjectMappingId;

    createObjectMapping({ objectMapping: record })
      .then((newId) => {
        newObjectMappingId = newId;
        const fieldMappings = this.selectedFieldApiNames.map((fieldApiName) => ({
          Object_Mapping__c: newId,
          Field_API_Name__c: fieldApiName,
          Is_Critical__c: false
        }));
        return createFieldMappings({ fieldMappings });
      })
      .then(() => {
        this.showToast(
          "Success",
          `Object Mapping created with ${this.selectedFieldApiNames.length} field mapping(s).`,
          "success"
        );
        this.closeAndNavigateToObjectMapping(newObjectMappingId);
      })
      .catch((error) => {
        if (newObjectMappingId) {
          // The Object Mapping itself saved fine; only the field mappings failed. Still take the
          // user to the new record — the related list is the normal place to add or fix them.
          this.showToast(
            "Object Mapping created, but field mappings failed",
            this.extractErrorMessage(error),
            "warning"
          );
          this.closeAndNavigateToObjectMapping(newObjectMappingId);
        } else {
          this.showToast("Error saving Object Mapping", this.extractErrorMessage(error), "error");
        }
      })
      .finally(() => {
        this.isSaving = false;
      });
  }

  saveEdit() {
    // Boundary_Application__c is deliberately omitted: Salesforce rejects any update DML that
    // includes a non-reparentable master-detail field under AccessLevel.USER_MODE, even when the
    // value sent back is unchanged — not just an FLS setting, a platform-level restriction. It's
    // read-only in the UI in edit mode anyway, so there's nothing to write back.
    const record = {
      Id: this.recordId,
      Object_API_Name__c: this.selectedObjectApiName,
      Operation__c: this.selectedOperations.join(";"),
      Sync_Frequency__c: this.syncFrequency || null,
      Last_Validated_Date__c: this.lastValidatedDate || null
    };

    const fieldsToAdd = this.selectedFieldApiNames.filter(
      (fieldApiName) => !this.originalFieldApiNames.includes(fieldApiName)
    );
    const fieldsToRemove = this.originalFieldApiNames.filter(
      (fieldApiName) => !this.selectedFieldApiNames.includes(fieldApiName)
    );

    let baseUpdateSucceeded = false;

    updateObjectMapping({ objectMapping: record })
      .then(() => {
        baseUpdateSucceeded = true;
        const tasks = [];
        if (fieldsToAdd.length) {
          tasks.push(
            createFieldMappings({
              fieldMappings: fieldsToAdd.map((fieldApiName) => ({
                Object_Mapping__c: this.recordId,
                Field_API_Name__c: fieldApiName,
                Is_Critical__c: false
              }))
            })
          );
        }
        if (fieldsToRemove.length) {
          tasks.push(
            deleteFieldMappings({
              fieldMappingIds: fieldsToRemove.map((fieldApiName) => this.fieldMappingIdByApiName[fieldApiName])
            })
          );
        }
        return Promise.all(tasks);
      })
      .then(() => {
        this.showToast("Success", "Object Mapping updated.", "success");
        this.closeAndNavigateToObjectMapping(this.recordId);
      })
      .catch((error) => {
        if (baseUpdateSucceeded) {
          this.showToast(
            "Object Mapping updated, but field mapping changes failed",
            this.extractErrorMessage(error),
            "warning"
          );
          this.closeAndNavigateToObjectMapping(this.recordId);
        } else {
          this.showToast("Error saving Object Mapping", this.extractErrorMessage(error), "error");
        }
      })
      .finally(() => {
        this.isSaving = false;
      });
  }

  closeAndNavigateToObjectMapping(recordId) {
    this.dispatchEvent(new CustomEvent("close"));
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId,
        objectApiName: "Object_Mapping__c",
        actionName: "view"
      }
    });
  }

  extractErrorMessage(error) {
    return error?.body?.message || error?.message || "An unknown error occurred.";
  }

  showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}