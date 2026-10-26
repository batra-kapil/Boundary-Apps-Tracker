/**
 * Agentforce and Flow action that reports which external Boundary Applications are connected
 * to a given Salesforce object or field. Call this action before recommending or making any
 * metadata change that could affect an external system, including: adding a new field, deleting
 * a field, changing a field's data type, deleting an object, or merging records (Account or
 * Contact merges invalidate record Ids, which can break integrations that cache those Ids).
 * The action never throws for an untracked object or field; instead it returns a response with
 * hasKnownBoundaryApplications set to false and a plain-language summary, so the calling agent
 * can confidently tell the user "no known boundary applications" instead of treating an empty
 * result as an error or an unknown.
 */
global with sharing class BoundaryImpactService {
    @InvocableMethod(
        label='Check Boundary Application Impact'
        description='Given a Salesforce object API name and optionally a field API name, returns all Boundary Applications, sync patterns, and criticality levels connected to it. Use this before recommending or making any metadata change (new field, field deletion, field type change, object deletion, or record merge) so the impact on connected external systems is known.'
        category='Boundary Application Tracker'
    )
    global static List<Response> checkBoundaryApplicationImpact(List<Request> requests) {
        List<Response> responses = new List<Response>();

        for (Request request : requests) {
            Response response = new Response();

            List<BoundaryImpactQueryService.BoundaryMappingRow> rows = BoundaryImpactQueryService.findBoundaryMappings(
                request.objectApiName,
                request.fieldApiName
            );

            if (rows.isEmpty()) {
                response.hasKnownBoundaryApplications = false;
                response.summary = String.isNotBlank(request.fieldApiName)
                    ? 'No known boundary applications are tracked for field ' + request.fieldApiName
                        + ' on object ' + request.objectApiName + '. No tracked external system depends on this field, '
                        + 'based on the current Boundary Application Tracker data.'
                    : 'No known boundary applications are tracked for object ' + request.objectApiName
                        + '. No tracked external system depends on this object, based on the current Boundary '
                        + 'Application Tracker data.';
                response.boundaryApplications = new List<BoundaryApplicationImpact>();
            } else {
                response.hasKnownBoundaryApplications = true;
                response.boundaryApplications = new List<BoundaryApplicationImpact>();

                for (BoundaryImpactQueryService.BoundaryMappingRow row : rows) {
                    BoundaryApplicationImpact impact = new BoundaryApplicationImpact();
                    impact.applicationName = row.applicationName;
                    impact.criticality = row.criticality;
                    impact.direction = row.direction;
                    impact.integrationPattern = row.integrationPattern;
                    impact.status = row.status;
                    impact.isCriticalField = row.isCriticalField;
                    impact.technicalOwnerName = row.technicalOwnerName;
                    impact.technicalOwnerEmail = row.technicalOwnerEmail;
                    impact.businessOwnerName = row.businessOwnerName;
                    impact.businessOwnerEmail = row.businessOwnerEmail;
                    impact.lastValidatedDate = row.lastValidatedDate;
                    impact.syncFrequency = row.syncFrequency;
                    impact.criticalExternalIdDependent = row.criticalExternalIdDependent;
                    response.boundaryApplications.add(impact);
                }

                Integer count = response.boundaryApplications.size();
                response.summary = count + (count == 1 ? ' boundary application is' : ' boundary applications are')
                    + ' connected to '
                    + (String.isNotBlank(request.fieldApiName) ? 'field ' + request.fieldApiName + ' on object ' : 'object ')
                    + request.objectApiName + '. Review each application\'s criticality and Is Critical Field flag '
                    + 'before proceeding with the metadata change.';
            }

            responses.add(response);
        }

        return responses;
    }

    /**
     * One request to check boundary application impact for a single Salesforce object, or a
     * single field on that object.
     */
    global class Request {
        @InvocableVariable(
            label='Object API Name'
            description='The API name of the Salesforce object to check, for example Account, Opportunity, or a custom object such as Invoice__c. Always required.'
            required=true
        )
        global String objectApiName;

        @InvocableVariable(
            label='Field API Name'
            description='The API name of a specific field to check on the object, for example Email or a custom field such as Legacy_Id__c. Leave blank to check impact at the object level only, for example before deleting the entire object or merging records of this type.'
            required=false
        )
        global String fieldApiName;
    }

    /**
     * The result of a boundary impact check for one request: whether any tracked external
     * systems depend on the object or field, a plain-language summary suitable for repeating
     * directly to a user, and the flat list of connected Boundary Applications with the details
     * needed to judge risk.
     */
    global class Response {
        @InvocableVariable(
            label='Has Known Boundary Applications'
            description='True if at least one Boundary Application is tracked as connected to the requested object or field. False means no tracked external system depends on it, based on current data in this package — it does not guarantee no integration exists, only that none has been recorded.'
        )
        global Boolean hasKnownBoundaryApplications;

        @InvocableVariable(
            label='Summary'
            description='A plain-language, ready-to-read sentence summarizing the impact check result. Safe to repeat directly to a user without further rewording.'
        )
        global String summary;

        @InvocableVariable(
            label='Boundary Applications'
            description='The flat list of Boundary Applications connected to the requested object or field, one entry per application (or per application per field, when a field was specified and multiple mappings match). Empty when Has Known Boundary Applications is false.'
        )
        global List<BoundaryApplicationImpact> boundaryApplications;
    }

    /**
     * One connected Boundary Application's details, flattened for easy reasoning by an LLM:
     * how critical it is, which direction data flows, how it integrates, who owns it, and
     * whether the specific field being checked is critical to it.
     */
    global class BoundaryApplicationImpact {
        @InvocableVariable(
            label='Application Name'
            description='The name of the connected Boundary Application (external system), for example "Netsuite ERP Sync" or "Marketo".'
        )
        global String applicationName;

        @InvocableVariable(
            label='Criticality'
            description='The business impact if this integration breaks: High, Medium, or Low. High means revenue or compliance impact — treat changes affecting this application with extra caution.'
        )
        global String criticality;

        @InvocableVariable(
            label='Direction'
            description='Whether this application sends data into Salesforce (Inbound), reads data out (Outbound), or both (Bidirectional).'
        )
        global String direction;

        @InvocableVariable(
            label='Integration Pattern'
            description='How this application exchanges data with Salesforce, for example Real-time API, Batch/Scheduled, CDC/Platform Event, Outbound Message, or Salesforce Connect. Real-time and CDC integrations tend to fail immediately on a breaking change; batch integrations may fail silently until their next run.'
        )
        global String integrationPattern;

        @InvocableVariable(
            label='Status'
            description='The current operational state of this integration: Active, Deprecated, or Planned. Only Active integrations have current-day impact.'
        )
        global String status;

        @InvocableVariable(
            label='Is Critical Field'
            description='True if the specific field being checked is critical to this application, meaning changing or deleting it would break the integration. False means the field is cosmetic or optional for this application. Blank/null when no specific field was checked (an object-level request).'
        )
        global Boolean isCriticalField;

        @InvocableVariable(
            label='Technical Owner Name'
            description='The full name of the Salesforce user who maintains this integration technically. Contact this person about technical changes.'
        )
        global String technicalOwnerName;

        @InvocableVariable(
            label='Technical Owner Email'
            description='The email address of the Salesforce user who maintains this integration technically.'
        )
        global String technicalOwnerEmail;

        @InvocableVariable(
            label='Business Owner Name'
            description='The full name of the Salesforce user who is accountable for this integration on the business side. Contact this person about business impact, especially for High criticality applications.'
        )
        global String businessOwnerName;

        @InvocableVariable(
            label='Business Owner Email'
            description='The email address of the Salesforce user who is accountable for this integration on the business side.'
        )
        global String businessOwnerEmail;

        @InvocableVariable(
            label='Last Validated Date'
            description='The date this connection was last confirmed accurate by the integration owner. A date older than six months means the mapping may be stale and should be re-verified before being relied on.'
        )
        global Date lastValidatedDate;

        @InvocableVariable(
            label='Sync Frequency'
            description='How often data syncs between Salesforce and this application, for example "Real-time", "Nightly batch", or "Every 15 minutes".'
        )
        global String syncFrequency;

        @InvocableVariable(
            label='Critical External Id Dependent'
            description='True if this external system stores or caches Salesforce record Ids. This makes the application high-risk specifically for record merges, since merges invalidate the losing record\'s Id, independent of the application\'s general Criticality rating.'
        )
        global Boolean criticalExternalIdDependent;
    }
}