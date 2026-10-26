/**
 * Read-only schema lookups backing the dynamic object/field pickers on the Object Mapping and
 * Field Mapping "New" screens. Not exposed as an MCP/Agentforce tool — called only from LWCs.
 * Both methods are cacheable since a global describe and object describes are relatively
 * expensive and their results don't change within a session.
 */
public with sharing class SchemaDiscoveryService {

    // Some managed-package objects/fields (Health Cloud, Field Service, etc.) fail to resolve a
    // translated label for the running user's locale and return this templated placeholder
    // string from getLabel() instead of throwing. Never surface it as a display label.
    private static final String MISSING_LABEL_MARKER = '__MISSING LABEL__';

    @AuraEnabled(cacheable=true)
    public static List<SchemaOption> getTrackableObjects() {
        List<SchemaOption> options = new List<SchemaOption>();

        for (Schema.SObjectType sobjType : Schema.getGlobalDescribe().values()) {
            Schema.DescribeSObjectResult objectDescribe;
            try {
                objectDescribe = sobjType.getDescribe();
            } catch (Exception e) {
                continue;
            }

            // Err toward including: only filter out objects the user can't see, or that are
            // obviously not real integration targets (hidden/deprecated types, custom settings).
            if (!objectDescribe.isAccessible() || objectDescribe.isDeprecatedAndHidden() || objectDescribe.isCustomSetting()) {
                continue;
            }

            String label;
            try {
                label = objectDescribe.getLabel();
            } catch (Exception e) {
                label = null;
            }

            SchemaOption option = new SchemaOption();
            option.label = sanitizeLabel(label, objectDescribe.getName());
            option.value = objectDescribe.getName();
            options.add(option);
        }

        options.sort();
        return options;
    }

    @AuraEnabled(cacheable=true)
    public static List<SchemaOption> getFieldsForObject(String objectApiName) {
        Schema.DescribeSObjectResult objectDescribe = describeAccessibleObject(objectApiName);

        List<SchemaOption> options = new List<SchemaOption>();
        for (Schema.SObjectField field : objectDescribe.fields.getMap().values()) {
            Schema.DescribeFieldResult fieldDescribe;
            try {
                fieldDescribe = field.getDescribe();
            } catch (Exception e) {
                continue;
            }
            if (!fieldDescribe.isAccessible()) {
                continue;
            }

            String label;
            try {
                label = fieldDescribe.getLabel();
            } catch (Exception e) {
                label = null;
            }

            SchemaOption option = new SchemaOption();
            option.label = sanitizeLabel(label, fieldDescribe.getName());
            option.value = fieldDescribe.getName();
            options.add(option);
        }

        options.sort();
        return options;
    }

    /**
     * Falls back to the API name when a describe's label comes back blank or as Salesforce's
     * "missing translation" placeholder string, which embeds arbitrary lookup-key text rather
     * than a usable label.
     */
    private static String sanitizeLabel(String label, String apiName) {
        if (String.isBlank(label) || label.contains(MISSING_LABEL_MARKER)) {
            return apiName;
        }
        return label;
    }

    private static Schema.DescribeSObjectResult describeAccessibleObject(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            throw friendlyError('An object API name is required to look up its fields.');
        }

        Schema.SObjectType sobjType = Schema.getGlobalDescribe().get(objectApiName);
        if (sobjType == null) {
            throw friendlyError('"' + objectApiName + '" is not a recognized Salesforce object.');
        }

        Schema.DescribeSObjectResult objectDescribe = sobjType.getDescribe();
        if (!objectDescribe.isAccessible()) {
            throw friendlyError('You do not have access to "' + objectApiName + '".');
        }

        return objectDescribe;
    }

    private static AuraHandledException friendlyError(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }

    /**
     * A label/value pair shaped to drop directly into a combobox-style option list.
     */
    public class SchemaOption implements Comparable {
        @AuraEnabled
        public String label;

        @AuraEnabled
        public String value;

        public Integer compareTo(Object other) {
            SchemaOption that = (SchemaOption) other;
            String thisLabel = this.label == null ? '' : this.label.toLowerCase();
            String thatLabel = that.label == null ? '' : that.label.toLowerCase();
            if (thisLabel == thatLabel) {
                return 0;
            }
            return thisLabel < thatLabel ? -1 : 1;
        }
    }
}
