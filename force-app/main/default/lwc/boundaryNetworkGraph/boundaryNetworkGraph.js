import { LightningElement, api, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { getRecordUi } from "lightning/uiRecordApi";
import getBoundaryImpact from "@salesforce/apex/BoundaryImpactController.getBoundaryImpact";
import getTrackedObjectApiNames from "@salesforce/apex/BoundaryImpactController.getTrackedObjectApiNames";

// Above this many connections, a single-ring diagram gets unreadable no matter how small the
// nodes get. Past the cap we show the most critical connections as nodes plus a "+N more" node
// that expands into a plain clickable list for the rest, instead of a dead end.
const MAX_VISIBLE_NODES = 12;
const MAX_LABEL_LENGTH = 18;
const LABEL_GAP = 14;
const LABEL_LINE_HEIGHT = 16;
const OVERFLOW_NODE_ID = "__overflow__";

const CRITICALITY_RANK = { High: 0, Medium: 1, Low: 2 };

const CRITICALITY_CLASS = {
  High: "graph-node_high",
  Medium: "graph-node_medium",
  Low: "graph-node_low"
};

const CRITICALITY_EDGE_CLASS = {
  High: "graph-edge_high",
  Medium: "graph-edge_medium",
  Low: "graph-edge_low"
};

const DIRECTION_EDGE_CLASS = {
  Inbound: "graph-edge_inbound",
  Outbound: "graph-edge_outbound",
  Bidirectional: "graph-edge_bidirectional"
};

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

function rankOf(criticality) {
  return CRITICALITY_RANK[criticality] !== undefined ? CRITICALITY_RANK[criticality] : 3;
}

function getInitials(name) {
  if (!name) {
    return "?";
  }
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

// The ring radius and node size grow with the node count (up to the cap) so a handful of
// connections aren't lost in a huge circle, and a dozen connections don't overlap each other.
function getLayoutTier(nodeCount) {
  if (nodeCount <= 4) {
    return { size: 420, center: 210, radius: 108, nodeRadius: 30 };
  }
  if (nodeCount <= 8) {
    return { size: 480, center: 240, radius: 145, nodeRadius: 25 };
  }
  return { size: 560, center: 280, radius: 185, nodeRadius: 21 };
}

export default class BoundaryNetworkGraph extends NavigationMixin(LightningElement) {
  // Set automatically by Lightning when placed on a record page.
  @api recordId;

  // Required when there is no recordId, e.g. on a dedicated app page.
  @api objectApiName;

  // Optional, narrows the graph to applications connected to a single field.
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
  showOverflowList = false;

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
    this.showOverflowList = false;
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
    // a definitive result arrives, so the graph doesn't get stuck showing nothing.
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

  get centerLabel() {
    if (!this.resolvedObjectApiName) {
      return "";
    }
    return this.fieldApiName ? `${this.resolvedObjectApiName}.${this.fieldApiName}` : this.resolvedObjectApiName;
  }

  get centerInitials() {
    return getInitials(this.resolvedObjectApiName);
  }

  // True once real data has come back, regardless of whether the current filters happen to
  // exclude everything — used to decide whether the filter controls should show at all.
  get hasAnyKnownApplications() {
    return !this.isLoading && !this.hasError && this.impactSummary && this.impactSummary.hasKnownBoundaryApplications;
  }

  get showFilters() {
    return this.hasAnyKnownApplications;
  }

  get filteredSortedApplications() {
    if (!this.impactSummary || !this.impactSummary.applications) {
      return [];
    }
    return [...this.impactSummary.applications]
      .filter((app) => this.selectedCriticalities.includes(app.criticality) && this.selectedDirections.includes(app.direction))
      .sort((a, b) => {
        const rankDiff = rankOf(a.criticality) - rankOf(b.criticality);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return (a.applicationName || "").localeCompare(b.applicationName || "");
      });
  }

  get showEmptyState() {
    return !this.isLoading && !this.hasError && this.impactSummary && !this.impactSummary.hasKnownBoundaryApplications;
  }

  get showNoFilterMatches() {
    return this.hasAnyKnownApplications && this.filteredSortedApplications.length === 0;
  }

  get hasNodes() {
    return this.hasAnyKnownApplications && this.filteredSortedApplications.length > 0;
  }

  handleCriticalityFilterChange(event) {
    this.selectedCriticalities = event.detail.value;
    this.showOverflowList = false;
  }

  handleDirectionFilterChange(event) {
    this.selectedDirections = event.detail.value;
    this.showOverflowList = false;
  }

  handleClearFilters() {
    this.selectedCriticalities = CRITICALITY_FILTER_OPTIONS.map((o) => o.value);
    this.selectedDirections = DIRECTION_FILTER_OPTIONS.map((o) => o.value);
    this.showOverflowList = false;
  }

  buildNode(app, x, y, tier) {
    const label = app.applicationName || "Unknown";
    const shortLabel = label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
    const isUpperHalf = y < tier.center - 10;
    const labelY = isUpperHalf ? y - tier.nodeRadius - LABEL_GAP : y + tier.nodeRadius + LABEL_GAP + LABEL_LINE_HEIGHT / 2;
    const labelPillWidth = Math.max(shortLabel.length * 7.2 + 20, 48);

    return {
      id: app.applicationId,
      shortLabel,
      initials: getInitials(app.applicationName),
      cx: x,
      cy: y,
      r: tier.nodeRadius,
      labelY,
      labelPillX: x - labelPillWidth / 2,
      labelPillY: labelY - LABEL_LINE_HEIGHT,
      labelPillWidth,
      lineX2: x,
      lineY2: y,
      nodeClass: `graph-node ${CRITICALITY_CLASS[app.criticality] || "graph-node_unknown"}`,
      edgeClass: `graph-edge ${CRITICALITY_EDGE_CLASS[app.criticality] || "graph-edge_unknown"} ${DIRECTION_EDGE_CLASS[app.direction] || ""}`,
      title: `${app.applicationName}: ${app.criticality || "Unknown"} criticality, ${app.direction || "Unknown direction"}, ${app.integrationPattern || "Unknown pattern"}`
    };
  }

  buildOverflowNode(count, x, y, tier) {
    const shortLabel = this.showOverflowList ? "Hide list" : `+${count} more`;
    const isUpperHalf = y < tier.center - 10;
    const labelY = isUpperHalf ? y - tier.nodeRadius - LABEL_GAP : y + tier.nodeRadius + LABEL_GAP + LABEL_LINE_HEIGHT / 2;
    const labelPillWidth = Math.max(shortLabel.length * 7.2 + 20, 48);

    return {
      id: OVERFLOW_NODE_ID,
      shortLabel,
      initials: `+${count}`,
      cx: x,
      cy: y,
      r: tier.nodeRadius,
      labelY,
      labelPillX: x - labelPillWidth / 2,
      labelPillY: labelY - LABEL_LINE_HEIGHT,
      labelPillWidth,
      lineX2: x,
      lineY2: y,
      nodeClass: "graph-node graph-node_overflow",
      edgeClass: "graph-edge graph-edge_overflow",
      title: `${count} more boundary application${count === 1 ? "" : "s"} connected. Click to ${this.showOverflowList ? "hide" : "show"} the list.`
    };
  }

  get graphModel() {
    if (!this.hasNodes) {
      return { viewBox: "0 0 420 420", centerX: 210, centerY: 210, centerR: 48, centerLabelY: 280, nodes: [], hasOverflow: false };
    }

    const apps = this.filteredSortedApplications;

    const overflowCount = Math.max(0, apps.length - MAX_VISIBLE_NODES);
    const visibleApps = overflowCount > 0 ? apps.slice(0, MAX_VISIBLE_NODES) : apps;
    const totalSlots = visibleApps.length + (overflowCount > 0 ? 1 : 0);
    const tier = getLayoutTier(totalSlots);
    const centerR = Math.round(tier.nodeRadius * 1.6);

    const nodes = visibleApps.map((app, index) => {
      const angle = (2 * Math.PI * index) / totalSlots - Math.PI / 2;
      const x = tier.center + tier.radius * Math.cos(angle);
      const y = tier.center + tier.radius * Math.sin(angle);
      return this.buildNode(app, x, y, tier);
    });

    if (overflowCount > 0) {
      const angle = (2 * Math.PI * visibleApps.length) / totalSlots - Math.PI / 2;
      const x = tier.center + tier.radius * Math.cos(angle);
      const y = tier.center + tier.radius * Math.sin(angle);
      nodes.push(this.buildOverflowNode(overflowCount, x, y, tier));
    }

    return {
      viewBox: `0 0 ${tier.size} ${tier.size}`,
      centerX: tier.center,
      centerY: tier.center,
      centerR,
      centerLabelY: tier.center + centerR + 22,
      nodes,
      hasOverflow: overflowCount > 0,
      overflowCount,
      visibleCount: visibleApps.length,
      totalCount: apps.length
    };
  }

  get overflowApplications() {
    if (!this.graphModel.hasOverflow || !this.showOverflowList) {
      return [];
    }
    const dotClass = { High: "legend-dot_high", Medium: "legend-dot_medium", Low: "legend-dot_low" };
    return this.filteredSortedApplications.slice(MAX_VISIBLE_NODES).map((app) => ({
      id: app.applicationId,
      applicationName: app.applicationName,
      criticality: app.criticality,
      direction: app.direction,
      dotClass: `legend-dot ${dotClass[app.criticality] || ""}`
    }));
  }

  handleNodeActivate(event) {
    const applicationId = event.currentTarget.dataset.id;
    if (!applicationId) {
      return;
    }
    if (applicationId === OVERFLOW_NODE_ID) {
      this.showOverflowList = !this.showOverflowList;
      return;
    }
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: applicationId,
        objectApiName: "Boundary_Application__c",
        actionName: "view"
      }
    });
  }

  handleNodeKeyUp(event) {
    if (event.key === "Enter" || event.key === " ") {
      this.handleNodeActivate(event);
    }
  }

  handleOverflowItemClick(event) {
    const applicationId = event.currentTarget.dataset.id;
    if (!applicationId) {
      return;
    }
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: applicationId,
        objectApiName: "Boundary_Application__c",
        actionName: "view"
      }
    });
  }
}
