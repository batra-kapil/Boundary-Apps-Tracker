/**
 * MCP-facing REST endpoint for the Boundary Impact check, called through Salesforce's Hosted
 * MCP Server as the authenticated end user (their own field-level security and sharing rules
 * apply — this class never runs as a dedicated integration user). Wraps the same
 * BoundaryImpactQueryService logic used by the Flow/Agentforce invocable action and the
 * Lightning component controller, but returns a flat, conversational JSON shape suited to being
 * read directly by an LLM rather than synthesized across nested collections.
 */
@RestResource(urlMapping='/boundaryImpact/*')
global with sharing class BoundaryImpactMcpResource {

    @HttpGet
    global static void checkImpact() {
        RestRequest request = RestContext.request;
        RestResponse response = RestContext.response;
        response.addHeader('Content-Type', 'application/json');

        String objectApiName = request.params.get('objectApiName');
        String fieldApiName = request.params.get('fieldApiName');

        if (String.isBlank(objectApiName)) {
            response.statusCode = 400;
            response.responseBody = Blob.valueOf(JSON.serialize(buildError(
                'objectApiName is required. Tell me which Salesforce object you want to check, e.g. Account.'
            )));
            return;
        }

        try {
            validateObjectAndField(objectApiName, fieldApiName);
            response.statusCode = 200;
            response.responseBody = Blob.valueOf(JSON.serialize(buildImpact(objectApiName, fieldApiName)));
        } catch (BoundaryImpactMcpException e) {
            response.statusCode = 400;
            response.responseBody = Blob.valueOf(JSON.serialize(buildError(e.getMessage())));
        } catch (System.QueryException e) {
            response.statusCode = 403;
            response.responseBody = Blob.valueOf(JSON.serialize(buildError(
                'I don\'t have access to check impact for that object — you may not have read access to Boundary Application records.'
            )));
        } catch (Exception e) {
            response.statusCode = 500;
            response.responseBody = Blob.valueOf(JSON.serialize(buildError(
                'Something went wrong checking boundary application impact. Please try again, and let an admin know if it keeps happening.'
            )));
        }
    }

    private static Map<String, Object> buildImpact(String objectApiName, String fieldApiName) {
        List<BoundaryImpactQueryService.BoundaryMappingRow> rows =
            BoundaryImpactQueryService.findBoundaryMappings(objectApiName, fieldApiName);

        Map<String, Object> result = new Map<String, Object>();
        result.put('objectApiName', objectApiName);
        result.put('fieldApiName', fieldApiName);

        if (!rows.isEmpty()) {
            result.put('hasKnownImpact', true);
            result.put('connectedApplications', toConnectedApplications(rows, fieldApiName));
            result.put('summary', buildFoundSummary(objectApiName, fieldApiName, rows));
            return result;
        }

        // Nothing matched this exact request. When a field was specified, check whether the
        // object itself has any tracked mappings at all — "this object was never documented in
        // the tracker" and "it's tracked, just not this field" are different claims, and an LLM
        // should not read them as the same thing.
        Boolean objectIsTracked = true;
        if (String.isNotBlank(fieldApiName)) {
            objectIsTracked = !BoundaryImpactQueryService.findBoundaryMappings(objectApiName, null).isEmpty();
        }

        result.put('hasKnownImpact', false);
        result.put('connectedApplications', new List<Object>());
        result.put('summary', buildEmptySummary(objectApiName, fieldApiName, objectIsTracked));
        return result;
    }

    private static List<Map<String, Object>> toConnectedApplications(
        List<BoundaryImpactQueryService.BoundaryMappingRow> rows,
        String fieldApiName
    ) {
        List<Map<String, Object>> apps = new List<Map<String, Object>>();
        for (BoundaryImpactQueryService.BoundaryMappingRow row : rows) {
            Map<String, Object> app = new Map<String, Object>();
            app.put('name', row.applicationName);
            app.put('criticality', row.criticality);
            app.put('direction', row.direction);
            app.put('integrationPattern', row.integrationPattern);
            if (String.isNotBlank(fieldApiName)) {
                app.put('fieldIsCritical', row.isCriticalField);
            }
            app.put('technicalOwner', row.technicalOwnerEmail);
            app.put('lastValidated', row.lastValidatedDate != null ? String.valueOf(row.lastValidatedDate) : null);
            apps.add(app);
        }
        return apps;
    }

    private static String buildFoundSummary(
        String objectApiName,
        String fieldApiName,
        List<BoundaryImpactQueryService.BoundaryMappingRow> rows
    ) {
        String subject = String.isNotBlank(fieldApiName) ? objectApiName + '.' + fieldApiName : objectApiName;

        List<String> highNames = new List<String>();
        List<String> otherNames = new List<String>();
        for (BoundaryImpactQueryService.BoundaryMappingRow row : rows) {
            if (row.criticality == 'High') {
                highNames.add(row.applicationName);
            } else {
                otherNames.add(row.applicationName);
            }
        }

        if (!highNames.isEmpty()) {
            String plural = highNames.size() == 1 ? 'integration depends' : 'integrations depend';
            String breaks = highNames.size() == 1 ? 'it' : 'them';
            return highNames.size() + ' high-criticality ' + plural + ' on ' + subject + ' (' + joinNames(highNames)
                + '). Changing or removing it will likely break ' + breaks + '.';
        }

        String plural = rows.size() == 1 ? 'integration depends' : 'integrations depend';
        return rows.size() + ' ' + plural + ' on ' + subject + ' (' + joinNames(otherNames)
            + '), none at high criticality. Review with the application owner before changing it.';
    }

    private static String buildEmptySummary(String objectApiName, String fieldApiName, Boolean objectIsTracked) {
        if (String.isBlank(fieldApiName)) {
            return 'No boundary applications are tracked for ' + objectApiName + '. This may mean nothing external '
                + 'depends on it, or simply that it has not been documented in the tracker yet.';
        }
        if (objectIsTracked) {
            return objectApiName + ' has tracked boundary applications, but none of them document a dependency on '
                + 'the ' + fieldApiName + ' field specifically. That could mean the field is safe to change, or '
                + 'that field-level detail for it has not been recorded yet — check with the application owners '
                + 'before assuming it is unused.';
        }
        return 'No boundary applications are tracked for ' + objectApiName + ' at all, so there is no field-level '
            + 'data for ' + fieldApiName + ' either.';
    }

    private static String joinNames(List<String> names) {
        if (names.isEmpty()) {
            return '';
        }
        if (names.size() <= 3) {
            return String.join(names, ', ');
        }
        List<String> firstThree = new List<String>{ names[0], names[1], names[2] };
        return String.join(firstThree, ', ') + ', and ' + (names.size() - 3) + ' more';
    }

    private static void validateObjectAndField(String objectApiName, String fieldApiName) {
        Schema.DescribeSObjectResult objectDescribe = describeObject(objectApiName);
        if (objectDescribe == null) {
            throw new BoundaryImpactMcpException(
                'I don\'t recognize the Salesforce object "' + objectApiName + '". Double-check the API name — '
                + 'it\'s case-sensitive, and custom objects need the __c suffix, e.g. Invoice__c.'
            );
        }
        if (String.isNotBlank(fieldApiName) && !objectDescribe.fields.getMap().containsKey(fieldApiName.toLowerCase())) {
            throw new BoundaryImpactMcpException(
                'I don\'t recognize the field "' + fieldApiName + '" on ' + objectApiName + '. Double-check the '
                + 'API name — it\'s case-sensitive, and custom fields need the __c suffix.'
            );
        }
    }

    private static Schema.DescribeSObjectResult describeObject(String objectApiName) {
        Schema.SObjectType sobjType = Schema.getGlobalDescribe().get(objectApiName);
        return sobjType != null ? sobjType.getDescribe() : null;
    }

    private static Map<String, Object> buildError(String message) {
        Map<String, Object> error = new Map<String, Object>();
        error.put('error', true);
        error.put('message', message);
        return error;
    }

    public class BoundaryImpactMcpException extends Exception {}
}