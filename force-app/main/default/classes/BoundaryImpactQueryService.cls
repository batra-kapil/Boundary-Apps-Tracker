/**
 * Shared query logic for looking up which Boundary Applications are connected to a given
 * Salesforce object or field. Both the BoundaryImpactService Agentforce/Flow action and the
 * BoundaryImpactController Lightning component controller call into this class so the two
 * entry points can never disagree about which records count as "connected".
 */
public with sharing class BoundaryImpactQueryService {
    /**
     * Finds every Object Mapping (and, when a field is specified, Field Mapping) that connects
     * a Boundary Application to the given Salesforce object or field.
     *
     * When fieldApiName is blank, every Object Mapping for the object is returned, one row per
     * mapping, without field-level detail. When fieldApiName is populated, only Object Mappings
     * that have at least one matching Field Mapping child are returned, one row per matching
     * Field Mapping, with the field-level detail populated.
     *
     * @param objectApiName the API name of the Salesforce object to look up, e.g. Account
     * @param fieldApiName the API name of the field to look up, or blank for an object-level check
     * @return one BoundaryMappingRow per matching Object Mapping or Field Mapping record
     */
    public static List<BoundaryMappingRow> findBoundaryMappings(String objectApiName, String fieldApiName) {
        List<BoundaryMappingRow> rows = new List<BoundaryMappingRow>();

        if (String.isBlank(objectApiName)) {
            return rows;
        }

        if (String.isBlank(fieldApiName)) {
            for (Object_Mapping__c mapping : [
                SELECT Id, Object_API_Name__c, Sync_Frequency__c, Last_Validated_Date__c,
                       Boundary_Application__c, Boundary_Application__r.Name,
                       Boundary_Application__r.Application_Type__c,
                       Boundary_Application__r.Integration_Pattern__c,
                       Boundary_Application__r.Direction__c,
                       Boundary_Application__r.Criticality__c,
                       Boundary_Application__r.Status__c,
                       Boundary_Application__r.Documentation_Link__c,
                       Boundary_Application__r.Critical_External_Id_Dependent__c,
                       Boundary_Application__r.Technical_Owner__r.Name,
                       Boundary_Application__r.Technical_Owner__r.Email,
                       Boundary_Application__r.Business_Owner__r.Name,
                       Boundary_Application__r.Business_Owner__r.Email
                FROM Object_Mapping__c
                WHERE Object_API_Name__c = :objectApiName
                WITH USER_MODE
            ]) {
                rows.add(toRow(mapping, null));
            }
        } else {
            for (Object_Mapping__c mapping : [
                SELECT Id, Object_API_Name__c, Sync_Frequency__c, Last_Validated_Date__c,
                       Boundary_Application__c, Boundary_Application__r.Name,
                       Boundary_Application__r.Application_Type__c,
                       Boundary_Application__r.Integration_Pattern__c,
                       Boundary_Application__r.Direction__c,
                       Boundary_Application__r.Criticality__c,
                       Boundary_Application__r.Status__c,
                       Boundary_Application__r.Documentation_Link__c,
                       Boundary_Application__r.Critical_External_Id_Dependent__c,
                       Boundary_Application__r.Technical_Owner__r.Name,
                       Boundary_Application__r.Technical_Owner__r.Email,
                       Boundary_Application__r.Business_Owner__r.Name,
                       Boundary_Application__r.Business_Owner__r.Email,
                       (SELECT Id, Field_API_Name__c, Is_Critical__c, External_System_Field_Name__c, Notes__c
                        FROM Field_Mappings__r
                        WHERE Field_API_Name__c = :fieldApiName)
                FROM Object_Mapping__c
                WHERE Object_API_Name__c = :objectApiName
                AND Id IN (SELECT Object_Mapping__c FROM Field_Mapping__c WHERE Field_API_Name__c = :fieldApiName)
                WITH USER_MODE
            ]) {
                for (Field_Mapping__c fieldMapping : mapping.Field_Mappings__r) {
                    rows.add(toRow(mapping, fieldMapping));
                }
            }
        }

        return rows;
    }

    private static BoundaryMappingRow toRow(Object_Mapping__c mapping, Field_Mapping__c fieldMapping) {
        BoundaryMappingRow row = new BoundaryMappingRow();
        row.applicationId = mapping.Boundary_Application__c;
        row.applicationName = mapping.Boundary_Application__r.Name;
        row.applicationType = mapping.Boundary_Application__r.Application_Type__c;
        row.integrationPattern = mapping.Boundary_Application__r.Integration_Pattern__c;
        row.direction = mapping.Boundary_Application__r.Direction__c;
        row.criticality = mapping.Boundary_Application__r.Criticality__c;
        row.status = mapping.Boundary_Application__r.Status__c;
        row.documentationLink = mapping.Boundary_Application__r.Documentation_Link__c;
        row.criticalExternalIdDependent = mapping.Boundary_Application__r.Critical_External_Id_Dependent__c;
        row.technicalOwnerName = mapping.Boundary_Application__r.Technical_Owner__r != null
            ? mapping.Boundary_Application__r.Technical_Owner__r.Name
            : null;
        row.technicalOwnerEmail = mapping.Boundary_Application__r.Technical_Owner__r != null
            ? mapping.Boundary_Application__r.Technical_Owner__r.Email
            : null;
        row.businessOwnerName = mapping.Boundary_Application__r.Business_Owner__r != null
            ? mapping.Boundary_Application__r.Business_Owner__r.Name
            : null;
        row.businessOwnerEmail = mapping.Boundary_Application__r.Business_Owner__r != null
            ? mapping.Boundary_Application__r.Business_Owner__r.Email
            : null;
        row.objectApiName = mapping.Object_API_Name__c;
        row.syncFrequency = mapping.Sync_Frequency__c;
        row.lastValidatedDate = mapping.Last_Validated_Date__c;

        if (fieldMapping != null) {
            row.fieldApiName = fieldMapping.Field_API_Name__c;
            row.isCriticalField = fieldMapping.Is_Critical__c;
            row.externalSystemFieldName = fieldMapping.External_System_Field_Name__c;
            row.fieldNotes = fieldMapping.Notes__c;
        }

        return row;
    }

    /**
     * A flat, plain data carrier for one Boundary Application's connection to the requested
     * object or field. Intentionally not annotated with @AuraEnabled or @InvocableVariable —
     * each calling class maps these rows onto its own annotated wrapper type, since the two
     * entry points expose slightly different shapes to Flow/Agentforce versus Lightning
     * components.
     */
    public class BoundaryMappingRow {
        public Id applicationId;
        public String applicationName;
        public String applicationType;
        public String integrationPattern;
        public String direction;
        public String criticality;
        public String status;
        public String documentationLink;
        public Boolean criticalExternalIdDependent;
        public String technicalOwnerName;
        public String technicalOwnerEmail;
        public String businessOwnerName;
        public String businessOwnerEmail;
        public String objectApiName;
        public String syncFrequency;
        public Date lastValidatedDate;
        public String fieldApiName;
        public Boolean isCriticalField;
        public String externalSystemFieldName;
        public String fieldNotes;
    }
}