/**
 * Write-side controller for the Object Mapping New/Edit screen (objectMappingCreator LWC), which
 * now also drives creation via the same page reused as both actions. Kept separate from
 * SchemaDiscoveryService so the read-only schema lookups and these write operations can be
 * permissioned independently.
 */
public with sharing class ObjectMappingCreatorController {

    /**
     * Powers the Boundary Application lookup on the New screen. lightning-record-picker didn't
     * render usable search results in this component's hosting context (nested inside the
     * ObjectMappingNewOverride Aura wrapper), so the picker is a schemaOptionPicker instead,
     * matching the pattern already used reliably for the Salesforce Object and Field pickers.
     */
    @AuraEnabled(cacheable=true)
    public static List<SchemaDiscoveryService.SchemaOption> getBoundaryApplications() {
        List<SchemaDiscoveryService.SchemaOption> options = new List<SchemaDiscoveryService.SchemaOption>();
        for (Boundary_Application__c app : [SELECT Id, Name FROM Boundary_Application__c WITH USER_MODE ORDER BY Name]) {
            SchemaDiscoveryService.SchemaOption option = new SchemaDiscoveryService.SchemaOption();
            option.label = app.Name;
            option.value = app.Id;
            options.add(option);
        }
        return options;
    }

    /**
     * Loads an existing Object Mapping's field values and its current Field Mapping children for
     * the Edit screen — one round trip rather than a separate getRecord wire plus a related-list
     * query, since the LWC needs both to pre-populate the form and to later diff which fields
     * were added or removed when the multi-select changes.
     */
    @AuraEnabled
    public static ObjectMappingEditData getObjectMappingForEdit(Id recordId) {
        Object_Mapping__c mapping = [
            SELECT Id, Boundary_Application__c, Object_API_Name__c, Operation__c,
                   Sync_Frequency__c, Last_Validated_Date__c
            FROM Object_Mapping__c
            WHERE Id = :recordId
            WITH USER_MODE
            LIMIT 1
        ];

        ObjectMappingEditData data = new ObjectMappingEditData();
        data.boundaryApplicationId = mapping.Boundary_Application__c;
        data.objectApiName = mapping.Object_API_Name__c;
        data.operation = mapping.Operation__c;
        data.syncFrequency = mapping.Sync_Frequency__c;
        data.lastValidatedDate = mapping.Last_Validated_Date__c;

        data.fieldMappingIdByFieldApiName = new Map<String, Id>();
        for (Field_Mapping__c fieldMapping : [
            SELECT Id, Field_API_Name__c
            FROM Field_Mapping__c
            WHERE Object_Mapping__c = :recordId
            WITH USER_MODE
        ]) {
            data.fieldMappingIdByFieldApiName.put(fieldMapping.Field_API_Name__c, fieldMapping.Id);
        }

        return data;
    }

    @AuraEnabled
    public static Id createObjectMapping(Object_Mapping__c objectMapping) {
        assertNoDuplicate(objectMapping);

        try {
            Database.insert(objectMapping, AccessLevel.USER_MODE);
        } catch (Exception e) {
            throw friendlyError('Could not save the Object Mapping: ' + e.getMessage());
        }
        return objectMapping.Id;
    }

    @AuraEnabled
    public static void updateObjectMapping(Object_Mapping__c objectMapping) {
        assertNoDuplicate(objectMapping);

        try {
            Database.update(objectMapping, AccessLevel.USER_MODE);
        } catch (Exception e) {
            throw friendlyError('Could not save the Object Mapping: ' + e.getMessage());
        }
    }

    // "Exact match" here is Boundary Application + Object + Operation, not just Boundary
    // Application + Object: the org already has legitimate cases (e.g. Workday HCM/Account) with
    // two Object Mappings for the same app and object but different Operation values (one Read,
    // one Upsert), so Operation has to be part of the identity, not just metadata. Excludes the
    // record's own Id so updating a record without changing its identity fields doesn't flag
    // itself as a duplicate.
    private static void assertNoDuplicate(Object_Mapping__c objectMapping) {
        List<Object_Mapping__c> existing = [
            SELECT Id, Name
            FROM Object_Mapping__c
            WHERE Boundary_Application__c = :objectMapping.Boundary_Application__c
            AND Object_API_Name__c = :objectMapping.Object_API_Name__c
            AND Operation__c = :objectMapping.Operation__c
            AND Id != :objectMapping.Id
            WITH USER_MODE
            LIMIT 1
        ];
        if (!existing.isEmpty()) {
            throw friendlyError(
                'An Object Mapping for this Boundary Application, object, and operation already exists (' +
                existing[0].Name + '). Edit that record instead of creating a duplicate.'
            );
        }
    }

    private static AuraHandledException friendlyError(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }

    /**
     * A flat carrier for everything the Edit screen needs to pre-populate itself in one call:
     * the record's own field values, plus its existing Field Mapping children keyed by field API
     * name so the LWC can both show what's currently selected and know which record Id to delete
     * if the user deselects a field.
     */
    public class ObjectMappingEditData {
        @AuraEnabled public Id boundaryApplicationId;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String operation;
        @AuraEnabled public String syncFrequency;
        @AuraEnabled public Date lastValidatedDate;
        @AuraEnabled public Map<String, Id> fieldMappingIdByFieldApiName;
    }
}
