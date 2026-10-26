/**
 * Apex controller backing the boundaryImpactPanel and boundaryNetworkGraph Lightning web
 * components. Wraps the same lookup logic as BoundaryImpactService (the Agentforce/Flow action)
 * so that what an admin sees on a record page always matches what Agentforce would report for
 * the same object and field.
 */
public with sharing class BoundaryImpactController {
    /**
     * Returns the Boundary Applications connected to a Salesforce object, optionally narrowed to
     * a single field, for display in a Lightning web component.
     *
     * @param objectApiName the API name of the Salesforce object to look up, e.g. Account
     * @param fieldApiName the API name of a specific field to narrow the check to, or null/blank
     *                      to return every application connected to the object
     * @return a summary containing whether any connections are known and the list of connected
     *         Boundary Applications
     */
    @AuraEnabled(cacheable=true)
    public static BoundaryImpactSummary getBoundaryImpact(String objectApiName, String fieldApiName) {
        BoundaryImpactSummary summary = new BoundaryImpactSummary();
        summary.objectApiName = objectApiName;
        summary.fieldApiName = fieldApiName;
        summary.applications = new List<BoundaryApplicationView>();

        List<BoundaryImpactQueryService.BoundaryMappingRow> rows = BoundaryImpactQueryService.findBoundaryMappings(
            objectApiName,
            fieldApiName
        );

        for (BoundaryImpactQueryService.BoundaryMappingRow row : rows) {
            BoundaryApplicationView view = new BoundaryApplicationView();
            view.applicationId = row.applicationId;
            view.applicationName = row.applicationName;
            view.applicationType = row.applicationType;
            view.criticality = row.criticality;
            view.direction = row.direction;
            view.integrationPattern = row.integrationPattern;
            view.status = row.status;
            view.documentationLink = row.documentationLink;
            view.criticalExternalIdDependent = row.criticalExternalIdDependent;
            view.technicalOwnerName = row.technicalOwnerName;
            view.businessOwnerName = row.businessOwnerName;
            view.syncFrequency = row.syncFrequency;
            view.lastValidatedDate = row.lastValidatedDate;
            view.isCriticalField = row.isCriticalField;
            view.externalSystemFieldName = row.externalSystemFieldName;
            summary.applications.add(view);
        }

        summary.hasKnownBoundaryApplications = !summary.applications.isEmpty();
        return summary;
    }

    /**
     * Returns the distinct Salesforce object API names that have at least one tracked Object
     * Mapping, sorted alphabetically. Used to populate an object picker in a Lightning web
     * component so an admin can only choose objects that actually have data to show, instead of
     * typing a free-text API name that might return nothing.
     *
     * @return the distinct tracked object API names, e.g. Account, Contact, Task
     */
    @AuraEnabled(cacheable=true)
    public static List<String> getTrackedObjectApiNames() {
        List<String> objectApiNames = new List<String>();
        for (AggregateResult result : [
            SELECT Object_API_Name__c objectApiName
            FROM Object_Mapping__c
            WITH USER_MODE
            GROUP BY Object_API_Name__c
            ORDER BY Object_API_Name__c
        ]) {
            objectApiNames.add((String) result.get('objectApiName'));
        }
        return objectApiNames;
    }

    /** Top-level result returned to the Lightning web component for one object/field lookup. */
    public class BoundaryImpactSummary {
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public String fieldApiName;
        @AuraEnabled
        public Boolean hasKnownBoundaryApplications;
        @AuraEnabled
        public List<BoundaryApplicationView> applications;
    }

    /** One connected Boundary Application, shaped for display as a chip or graph node. */
    public class BoundaryApplicationView {
        @AuraEnabled
        public Id applicationId;
        @AuraEnabled
        public String applicationName;
        @AuraEnabled
        public String applicationType;
        @AuraEnabled
        public String criticality;
        @AuraEnabled
        public String direction;
        @AuraEnabled
        public String integrationPattern;
        @AuraEnabled
        public String status;
        @AuraEnabled
        public String documentationLink;
        @AuraEnabled
        public Boolean criticalExternalIdDependent;
        @AuraEnabled
        public String technicalOwnerName;
        @AuraEnabled
        public String businessOwnerName;
        @AuraEnabled
        public String syncFrequency;
        @AuraEnabled
        public Date lastValidatedDate;
        @AuraEnabled
        public Boolean isCriticalField;
        @AuraEnabled
        public String externalSystemFieldName;
    }
}
