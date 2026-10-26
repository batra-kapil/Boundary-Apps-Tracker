/**
 * Write-side controller for Field_Mapping__c records, called from objectMappingCreator's field
 * multi-select — both on initial create (bulk-create one Field Mapping per selected field) and
 * on edit (bulk-create newly-added fields, bulk-delete deselected ones). There's no standalone
 * one-at-a-time "New Field Mapping" screen anymore, since mapping fields individually didn't
 * scale for objects with many fields.
 */
public with sharing class FieldMappingCreatorController {

    @AuraEnabled
    public static List<Id> createFieldMappings(List<Field_Mapping__c> fieldMappings) {
        if (fieldMappings == null || fieldMappings.isEmpty()) {
            return new List<Id>();
        }

        Id objectMappingId = fieldMappings[0].Object_Mapping__c;
        Set<String> fieldApiNames = new Set<String>();
        for (Field_Mapping__c fieldMapping : fieldMappings) {
            fieldApiNames.add(fieldMapping.Field_API_Name__c);
        }

        // A given field shouldn't be mapped twice under the same Object Mapping. Checked in bulk
        // up front (one query for the whole batch) rather than per record, since this can insert
        // many Field Mappings at once.
        Map<String, Field_Mapping__c> existingByFieldApiName = new Map<String, Field_Mapping__c>();
        for (Field_Mapping__c existing : [
            SELECT Id, Name, Field_API_Name__c
            FROM Field_Mapping__c
            WHERE Object_Mapping__c = :objectMappingId
            AND Field_API_Name__c IN :fieldApiNames
            WITH USER_MODE
        ]) {
            existingByFieldApiName.put(existing.Field_API_Name__c, existing);
        }

        if (!existingByFieldApiName.isEmpty()) {
            List<String> duplicateDescriptions = new List<String>();
            for (Field_Mapping__c existing : existingByFieldApiName.values()) {
                duplicateDescriptions.add(existing.Field_API_Name__c + ' (' + existing.Name + ')');
            }
            throw friendlyError(
                'These fields are already mapped under this Object Mapping: ' +
                String.join(duplicateDescriptions, ', ') + '.'
            );
        }

        try {
            Database.insert(fieldMappings, AccessLevel.USER_MODE);
        } catch (Exception e) {
            throw friendlyError('Could not save the Field Mappings: ' + e.getMessage());
        }

        List<Id> ids = new List<Id>();
        for (Field_Mapping__c fieldMapping : fieldMappings) {
            ids.add(fieldMapping.Id);
        }
        return ids;
    }

    @AuraEnabled
    public static void deleteFieldMappings(List<Id> fieldMappingIds) {
        if (fieldMappingIds == null || fieldMappingIds.isEmpty()) {
            return;
        }
        try {
            Database.delete(fieldMappingIds, AccessLevel.USER_MODE);
        } catch (Exception e) {
            throw friendlyError('Could not remove the field mapping(s): ' + e.getMessage());
        }
    }

    private static AuraHandledException friendlyError(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }
}
