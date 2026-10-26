import { LightningElement, api, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { getRecordUi } from "lightning/uiRecordApi";
import getBoundaryImpact from "@salesforce/apex/BoundaryImpactController.getBoundaryImpact";
import getTrackedObjectApiNames from "@salesforce/apex/BoundaryImpactController.getTrackedObjectApiNames";

const CRITICALITY_CHIP_CLASS = {
  High: "slds-theme_error slds-text-color_inverse",
  Medium: "slds-theme_warning",
  Low: "slds-theme_success slds-text-color_inverse"
};

const BOUNDARY_APPLICATION_OBJECT_API_NAME = "Boundary_Application__c";

const CRITICALITY_FILTER_OPTIONS = [
  { label: "High", value: "High" },
  { label: "Medium", value: "Medium" },
  { label: "Low", value: "Low" }
];

const DIRECTION_FILTER_OPTIONS = [
  { label: "Inbound", value: "Inbound" },
  { label: "Outbound", value: "Outbound" },
  { label: "Bidirectional", value: "Bidirectional" }
];

export default class BoundaryImpactPanel extends NavigationMixin(LightningElement) {
  // Set automatically by Lightning when placed on a record page.
  @api recordId;

  // Optional explicit override, for use on a Flow screen or utility bar item where there is no recordId.
  @api objectApiName;

  // Optional explicit field, for narrowing the check to a single field instead of the whole object.
  @api fieldApiName;

  resolvedObjectApiName;
  impactSummary;
  hasError = false;
  isLoading = true;
  objectOptions = [];
  criticalityFilterOptions = CRITICALITY_FILTER_OPTIONS;
  directionFilterOptions = DIRECTION_FILTER_OPTIONS;
  selectedCriticalities = CRITICALITY_FILTER_OPTIONS.map((o) => o.value);
  selectedDirections = DIRECTION_FILTER_OPTIONS.map((o) => o.value);

  connectedCallback() {
    if (!this.recordId && this.objectApiName) {
      this.resolvedObjectApiName = this.objectApiName;
    }
  }

  get recordIdList() {
    return this.recordId ? [this.recordId] : undefined;
  }

  // Only offer the picker away from a record page — on a record page the object is fixed to
  // whatever record this is, and shouldn't be user-changeable.
  get showObjectPicker() {
    return !this.recordId;
  }

  get needsObjectSelection() {
    return this.showObjectPicker && !this.resolvedObjectApiName;
  }

  @wire(getTrackedObjectApiNames)
  wiredObjectOptions({ data }) {
    if (data) {
      this.objectOptions = data.map((name) => ({ label: name, value: name }));
    }
  }

  handleObjectChange(event) {
    this.resolvedObjectApiName = event.detail.value;
  }

  @wire(getRecordUi, { recordIds: "$recordIdList", layoutTypes: "Compact", modes: "View" })
  wiredRecordUi({ data }) {
    if (data && this.recordId) {
      const record = data.records[this.recordId];
      if (record) {
        this.resolvedObjectApiName = record.apiName;
      }
    }
  }

  // The wire service treats an undefined reactive parameter as "not ready" and never calls the
  // Apex method. fieldApiName is optional and often left undefined (e.g. unset on an app page),
  // so it's normalized to null here — a real value — or the wire would stall forever.
  get safeFieldApiName() {
    return this.fieldApiName || null;
  }

  @wire(getBoundaryImpact, { objectApiName: "$resolvedObjectApiName", fieldApiName: "$safeFieldApiName" })
  wiredImpact({ data, error }) {
    // The wire can re-provision with neither data nor error while parameters are still settling
    // (e.g. objectApiName resolving after connectedCallback). Only leave the loading state once
    // a definitive result arrives, so the card doesn't get stuck showing nothing.
    if (data) {
      this.impactSummary = data;
      this.hasError = false;
      this.isLoading = false;
    } else if (error) {
      this.hasError = true;
      this.impactSummary = undefined;
      this.isLoading = false;
    }
  }

  get showEmptyState() {
    return !this.isLoading && !this.hasError && this.impactSummary && !this.impactSummary.hasKnownBoundaryApplications;
  }

  // True once real data has come back, regardless of whether the current filters happen to
  // exclude everything — used to decide whether the filter controls and "no matches" messaging
  // should show at all.
  get hasAnyKnownApplications() {
    return !this.isLoading && !this.hasError && this.impactSummary && this.impactSummary.hasKnownBoundaryApplications;
  }

  get showFilters() {
    return this.hasAnyKnownApplications;
  }

  get filteredRawApplications() {
    if (!this.impactSummary || !this.impactSummary.applications) {
      return [];
    }
    return this.impactSummary.applications.filter(
      (app) => this.selectedCriticalities.includes(app.criticality) && this.selectedDirections.includes(app.direction)
    );
  }

  get showNoFilterMatches() {
    return this.hasAnyKnownApplications && this.filteredRawApplications.length === 0;
  }

  get showResults() {
    return this.hasAnyKnownApplications && this.filteredRawApplications.length > 0;
  }

  handleCriticalityFilterChange(event) {
    this.selectedCriticalities = event.detail.value;
  }

  handleDirectionFilterChange(event) {
    this.selectedDirections = event.detail.value;
  }

  handleClearFilters() {
    this.selectedCriticalities = CRITICALITY_FILTER_OPTIONS.map((o) => o.value);
    this.selectedDirections = DIRECTION_FILTER_OPTIONS.map((o) => o.value);
  }

  get applications() {
    return this.filteredRawApplications.map((app) => {
      return {
        ...app,
        chipClass: CRITICALITY_CHIP_CLASS[app.criticality] || "slds-theme_shade",
        accordionLabel: `${app.applicationName} — ${app.criticality || "Unknown"} criticality`,
        technicalOwnerDisplay: app.technicalOwnerName || "Not set",
        businessOwnerDisplay: app.businessOwnerName || "Not set",
        syncFrequencyDisplay: app.syncFrequency || "Not documented",
        lastValidatedDisplay: app.lastValidatedDate || "Not yet validated",
        showCriticalFieldFlag: app.isCriticalField !== null && app.isCriticalField !== undefined,
        isCriticalFieldDisplay: app.isCriticalField ? "Yes — breaking this field will break this integration" : "No — this field is not critical to this integration"
      };
    });
  }

  handleTrackNew() {
    this[NavigationMixin.Navigate]({
      type: "standard__objectPage",
      attributes: {
        objectApiName: BOUNDARY_APPLICATION_OBJECT_API_NAME,
        actionName: "new"
      }
    });
  }
}
