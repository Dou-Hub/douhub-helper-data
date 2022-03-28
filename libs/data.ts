//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import { isString, map, isNil, isArray, without, isNumber, each, endsWith, cloneDeep } from 'lodash';
import {
    isObject, newGuid, isNonEmptyString, _track, _process,
    getRecordDisplay, getRecordAbstract, applyRecordSlug,
    utcISOString, getEntity, getRecordFullName,
    checkEntityPrivilege, checkRecordPrivilege, doNothing
} from 'douhub-helper-util';
import {
    HTTPERROR_403, HTTPERROR_400, sendAction, ERROR_PARAMETER_MISSING,
    ERROR_PARAMETER_INVALID, checkRecordToken, ERROR_PERMISSION_DENIED
} from 'douhub-helper-lambda';

import { processQuery } from './data-query-processor';
import { processResult } from './data-result-processor';
import { cleanHTML, getBaseDomain } from './data-web';
import { cosmosDBQuery, cosmosDBUpsert, cosmosDBDelete, cosmosDBRetrieveById, cosmosDBQueryWithAzureInfo, DEFAULT_USER_ATTRIBUTES, DEFAULT_LOOKUP_ATTRIBUTES } from 'douhub-helper-service';

if (!isObject(_process.relatedRecords)) {
    _process.relatedRecords = {};
}

export const retrieveRecordByToken = async (token: string, settings?: {
    attributes?: string
}): Promise<Record<string, any> | null> => {
    return await checkRecordToken(token, settings);
};

export const retrieveRecordById = async (context: Record<string, any>, id: string, settings?: {
    attributes?: string[],
    skipSecurityCheck?: boolean
}): Promise<Record<string, any> | null> => {
    const records = await retrieveBase(context, [id], settings);
    return records.length >= 0 ? records[0] : null;
};

export const retrieveRecordByIds = async (context: Record<string, any>, ids: string[], settings?: {
    attributes?: string[],
    skipSecurityCheck?: boolean
}): Promise<Array<Record<string, any>>> => {
    return await retrieveBase(context, ids, settings);
};

//retrieve one or multiple records
export const retrieveBase = async (context: Record<string, any>, ids: string[], settings?: {
    attributes?: string[],
    skipSecurityCheck?: boolean,
    query?: Record<string, any>
}): Promise<Array<Record<string, any>>> => {

    if (!isObject(settings)) settings = {};
    const query = settings?.query ? settings.query : {}
    query.ids = ids;
    query.attributes = settings?.attributes;
    query.ignorePage = true;

    if (_track) console.log('retrieveBase', query);


    //For retrieve, we will retrive the record first without security check
    let result = await queryBase(context, query, true); //skipSecurityCheck=true

    if (_track) console.log('retrieveBase', result);

    //Then we will check security based on the result, because result will has entityName, entityType, organizationId, 
    //Result has more attrs for security check
    if (!settings?.skipSecurityCheck && result.data.length > 0) {

        result.data = without(map(result.data, (data) => {
            if (data.isGlobal || settings?.skipSecurityCheck) return data;

            //check privilege, lookup request will not check privilege. the returned data properties are limited in cosmos-db-query-processor.js
            if (query?.lookup != true && !checkRecordPrivilege(context, data, "read")) {
                if (_track) console.log(`retrieveBase checkRecordPrivilege(context, data, "read")=false`);
                return null;
            }

            return data;
        }), null);
    }

    return result.data;

};


export const queryRecords = async (context: Record<string, any>, query: Record<string, any>, skipSecurityCheck?: boolean): Promise<Record<string, any>> => {
    return await queryBase(context, query, skipSecurityCheck);
};

export const queryBase = async (context: Record<string, any>, query: Record<string, any>, skipSecurityCheck?: boolean): Promise<Record<string, any>> => {

    //Process the query and transform the query to the CosmosDb format
    query = processQuery(context, query, skipSecurityCheck);
    if (_track) console.log({ processedQuery: query });
    return await queryRaw(context, query);
};

export const queryRaw = async (context: Record<string, any>, query: Record<string, any>): Promise<Record<string, any>> => {

    //const organizationId = context && isObject(context.organization) && context.organization.id ? context.organization.id : null;
    //const options = isNonEmptyString(organizationId) && !enableCrossPartitionQuery ? { partitionKey: organizationId } : { enableCrossPartitionQuery: true };
    //const options = { enableCrossPartitionQuery: true };
    // const scope = isNonEmptyString(query.scope) ? query.scope.toLowerCase() : '';
    // if (scope == 'global' || scope == 'global-and-mine') {
    //     options.enableCrossPartitionQuery = true;
    //     delete options.partitionKey;
    // }

    const pageSize = isNumber(query.pageSize) && query.pageSize >= 1 ? query.pageSize : 20;
    if (!isNumber(query.pageNumber)) query.pageNumber = 1;

    if (query.pageNumber <= 0) query.pageNumber = 1;
    const continuation = (query.pageNumber - 1) * pageSize;

    // if (query.pageSize) {

    query.query = `${query.query} OFFSET @continuation LIMIT @pageSize`;
    query.parameters.push({
        name: '@continuation',
        value: continuation
    });
    query.parameters.push({
        name: '@pageSize',
        value: pageSize
    });
    // }

    delete query.pageNumber;
    delete query.continuation;
    delete query.pageSize;
    delete query.ignorePage;

    if (_track) console.log({ query: JSON.stringify(query.query), parameters: JSON.stringify(query.parameters) });

    const response = await cosmosDBQueryWithAzureInfo(query.query, query.parameters);
    const results = response.resources;

    //In some cases we will have to retrieve more data
    let data = await retrieveRelatedRecords(query, results);

    if (!isArray(data)) data = [];

    //process result
    data = processResult(context, data);

    const result: Record<string, any> = {
        _charge: isObject(response.headers) ? response.headers['x-ms-request-charge'] : 0,
        data,
        count: data.length
    };

    if (isNumber(continuation) && pageSize >= 1 && data.length == pageSize) {
        result.continuation = continuation + data.length;
    }
    if (_track) console.log({ result });
    return result;


};

export const retrieveRelatedRecords = async (query: Record<string, any>, records: Array<Record<string, any>>): Promise<Array<Record<string, any>>> => {

    if (!isArray(records) || isArray(records) && records.length == 0) return [];
    let data = cloneDeep(records);

      if (query.includeOwnedByInfo) {

        let ownerAttrs = DEFAULT_USER_ATTRIBUTES;
        //includeOwnerInfo may be a list of attributes for the user records
        if (isNonEmptyString(query.includeOwnedByInfo)) {
            ownerAttrs = query.includeOwnedByInfo;
        }

        data = await retrieveRelatedRecordsBase('ownedBy', ownerAttrs.split(','), 'ownedBy_info', data);
    }


    if (query.includeOrganizationIdInfo) {

        let orgAttrs = 'id,name,introduction';
        //includeOrganizationIdInfo may be a list of attributes for the org records
        if (isNonEmptyString(query.includeOrganizationIdInfo)) {
            orgAttrs = query.includeOrganizationIdInfo;
        }

        data = await retrieveRelatedRecordsBase('organizationId', orgAttrs.split(','), 'organizationId_info', data);
    }

    if (query.includeUserInfo) {

        let userAttrs = DEFAULT_USER_ATTRIBUTES;
        //includeUserInfo may be a list of attributes for the user records
        if (isNonEmptyString(query.includeUserInfo)) {
            userAttrs = query.includeOrganizationIdInfo;
        }

        data = await retrieveRelatedRecordsBase('userId', userAttrs.split(','), 'userId_info', data);
    }

    const includeLookups = query.includeLookups;
    if (isArray(includeLookups) && includeLookups.length > 0) {

        for (var i = 0; i < includeLookups.length; i++) {
            if (isNonEmptyString(includeLookups[i].fieldName)) {
                let lookupAttrs = isNonEmptyString(includeLookups[i].attributes) ? includeLookups[i].attributes : DEFAULT_LOOKUP_ATTRIBUTES;
                data = await retrieveRelatedRecordsBase(includeLookups[i].fieldName, lookupAttrs.split(','), `${includeLookups[i].fieldName}_info`, data);
            }
        }
    }

    return data;
};

export const retrieveRelatedRecordsCache = (id: string): Record<string, any> => {
    const r = _process.relatedRecords[id];
    //-10*1000 make sure it is expired earlier so 
    //retrieveRelatedRecordsCache in the retrieveRelatedRecordsBase will not get null in a sequencial calls 
    return r && r.ts > Date.now() - 10 * 1000 ? r.record : null;
}


export const insertRelatedRecordsCache = (record: Record<string, any>) => {
    _process.relatedRecords[record.id] = { record, ts: Date.now() + 60 * 60 * 1000 }; //expire in 1 hr
}

export const retrieveRelatedRecordsBase = async (
    idFieldName: string,
    resultFieldNames: string[],
    objectFieldName: string,
    records: Array<Record<string, any>>): Promise<Array<Record<string, any>>> => {

    if (!isArray(records) || isArray(records) && records.length == 0) return [];
    let data = cloneDeep(records);


    //we need get all ids 
    let ids:any = '';
    each(data, (r) => {
        const id = r[idFieldName];
        if (isNonEmptyString(id) && isNil(retrieveRelatedRecordsCache(id)) && ids.indexOf(id) < 0) {
            ids = ids.length == 0 ? `${id}` : `${ids},${id}`;
        }
    });

    if (ids.length > 0) {
        //retrieve all owner records
        let queryStatement = `SELECT ${map(resultFieldNames, (resultFieldName: string) => `c.${resultFieldName}`).join(',')} FROM c WHERE c.id IN `;
        const queryParams: { name: string, value: any }[] = [];
        ids = ids.split(',');
        each(ids, (id: string, i: number) => {
            
            queryStatement = `${queryStatement} ${i == 0 ? '(' : ''} @p${i} ${i == ids.length - 1 ? ')' : ','}`;
            queryParams.push({
                name: `@p${i}`,
                value: id
            })
        })

        if (_track) console.log({ queryStatement, queryParams });

        const records = await cosmosDBQuery(queryStatement, queryParams);

        each(records, (r) => {
            insertRelatedRecordsCache(r);
        });
    }

    data = each(data, (r) => {
        r[objectFieldName] = retrieveRelatedRecordsCache(r[idFieldName]);
    });

    return data;
};



export type UpsertSettings = {
    skipExistingData?: boolean,
    skipDuplicationCheck?: boolean,
    updateOnly?: boolean,
    skipSecurityCheck?: boolean,
    skipSystemPropertyCheck?: boolean
}

export const createRecord = async (context: Record<string, any>, record: Record<string, any>, settings?: UpsertSettings): Promise<Record<string, any>> => {

    const source = 'createRecord';

    if (!isObject(record)) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record) is not provided.',
                parameters: { record }
            }
        }
    }

    if (!isNonEmptyString(record.entityName)) {
        throw {
            ...HTTPERROR_403,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record.entityName) is not provided.',
                parameters: { record }
            }
        }
    }

    const data = cloneDeep(record);

    const { userId } = context;
    const utcNow = utcISOString();

    if (!isObject(settings)) settings = {};
    const skipSecurityCheck = settings?.skipSecurityCheck == true;

    data.createdBy = userId;
    data.createdOn = utcNow;
    data.ownedBy = userId;
    data.ownedOn = utcNow;



    if (!skipSecurityCheck) {
        const entityType = data.entityType;
        const entityName = data.entityName;

        if (!checkEntityPrivilege(context, entityName, entityType, 'create')) {
            throw {
                ...HTTPERROR_403,
                type: ERROR_PERMISSION_DENIED,
                source
            }
        }
    }

    return await upsertRecord(context, data, 'create', settings);
};

export const deleteRecord = async (context: Record<string, any>, id: string, settings?: Record<string, any>): Promise<Record<string, any> | undefined> => {

    if (!isNonEmptyString(id)) throw HTTPERROR_403;
    if (!isObject(settings)) settings = {};
    const record = await cosmosDBRetrieveById(id);
    return record ? await deleteRecordBase(context, record, settings) : undefined;
};


export const deleteRecordBase = async (context: Record<string, any>, record: Record<string, any>, settings?: Record<string, any>): Promise<Record<string, any>> => {

    if (!isObject(record)) return record;
    if (!isObject(settings)) settings = {};

    const data = cloneDeep(record);

    const skipSecurityCheck = settings?.skipSecurityCheck == true;
    const skipAction = settings?.skipAction == true;


    if (!skipSecurityCheck && !checkRecordPrivilege(context, data, 'delete')) {
        throw HTTPERROR_403;
    }

    await cosmosDBDelete(data);

    if (!skipAction) {
        const { userId, organizationId, solutionId } = context;
        await sendAction('data', data, { name: 'delete', userId, organizationId, solutionId, requireUserId: false, requireOrganizationId: false });
    }
    return data;
};


//Update data is full record, otherwise use partialUpdate
export const updateRecord = async (context: Record<string, any>, record: Record<string, any>, settings?: UpsertSettings): Promise<Record<string, any>> => {

    const source = 'updateRecord';
    if (!isObject(settings)) settings = {};
    const skipSecurityCheck = settings?.skipSecurityCheck == true;

    if (!isObject(record)) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record) is not provided.',
                parameters: { record }
            }
        }
    }

    if (!isNonEmptyString(record.id)) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record.id) is not provided.',
                parameters: { record }
            }
        }
    }

    if (!isNonEmptyString(record.entityName)) {
        throw {
            ...HTTPERROR_403,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'record.entityName'
            }
        }
    }

    if (!skipSecurityCheck && !checkRecordPrivilege(context, record, 'update')) {
        throw {
            ...HTTPERROR_403,
            type: ERROR_PERMISSION_DENIED,
            source
        }
    }

    return await upsertRecord(context, record, 'update', { ...settings, updateOnly: true, skipSecurityCheck: true });
};


export const partialUpdateRecord = async (context: Record<string, any>, record: Record<string, any>, settings?: Record<string, any>): Promise<Record<string, any>> => {

    const source = 'partialUpdateRecord';

    if (!isObject(record)) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record) is not provided.'
            }
        }
    }

    if (!isNonEmptyString(record.id)) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (record.id) is not provided.'
            }
        }
    }


    //we will have to get the record first
    const existingRecord = cosmosDBRetrieveById(record.id);

    if (!existingRecord) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_INVALID,
            source,
            detail: {
                reason: 'The record does not exist.',
                parameters: { id: record.id }
            }
        }
    }

    return await updateRecord(context, { ...existingRecord, ...record }, settings);
};


//upsert will have no permission check, it is simply a base function to be called with fully trust
export const upsertRecord = async (context: Record<string, any>, record: Record<string, any>, actionName: string, settings?: UpsertSettings): Promise<Record<string, any>> => {


    if (!isObject(record)) throw 'The record is not provided.';

    let data = cloneDeep(record);

    settings = settings ? settings : {}
    const {
        skipExistingData,
        updateOnly,
    } = settings;

    const skipSecurityCheck = settings?.skipSecurityCheck == true;
    const skipSystemPropertyCheck = settings?.skipSystemPropertyCheck == true;
    const skipDuplicationCheck = settings?.skipDuplicationCheck == true;


    if (!skipSecurityCheck && (data.id && !checkRecordPrivilege(context, data, 'update') || !data.id && !checkRecordPrivilege(context, data, 'create'))) {
        throw HTTPERROR_403;
    }

    //we will process data first 
    data = await processUpsertData(context, data, {
        skipExistingData,
        skipDuplicationCheck,
        skipSystemPropertyCheck,
        updateOnly
    });


    data = await cosmosDBUpsert(data);

    const { userId, organizationId, solutionId } = context;
    await sendAction('data', data,
        {
            requireUserId: false,
            requireOrganizationId: false,
            name: actionName || 'upsert',
            userId,
            organizationId,
            solutionId
        });
    return data;
};


export const processUpsertData = async (context: Record<string, any>, data: Record<string, any>, settings?: {
    skipExistingData?: boolean,
    skipDuplicationCheck?: boolean,
    updateOnly?: boolean,
    skipSystemPropertyCheck?: boolean
}) => {

    const source = 'processUpsertData';
    const entityType = data.entityType;
    const entityName = data.entityName;
    const user = isObject(context.user) && context.user.id ? context.user : { id: context.userId };
    if (!isNonEmptyString(user.id)) throw 'There is no userId or user defined in the context.';
    const isNew = !isNonEmptyString(data.id);

    const skipExistingData = settings?.skipExistingData == true;
    const skipDuplicationCheck = settings?.skipDuplicationCheck == true;
    const updateOnly = settings?.updateOnly == true;
    const skipSystemPropertyCheck = settings?.skipSystemPropertyCheck == true;

    if (updateOnly && isNew) {
        throw {
            ...HTTPERROR_400,
            type: ERROR_PARAMETER_MISSING,
            source,
            detail: {
                reason: 'The parameter (data.id) is not provided.',
                parameters: { data }
            }
        }
    }

    let entity: Record<string, any> | null = null;
    const solution = isObject(context.solution) ? context.solution : { id: context.solutionId };

    //delete unsupported props
    delete data['_charge'];
    delete data.highlight;
    delete data.temp;
    delete data.token;

    delete data.uiDoing;
    delete data.uiDisabled;
    delete data.uiHidden;

    //all xxx_info will not be allowed, because _info is system reserved for special query result
    for (var prop in data) {
        if (endsWith(prop, '_info')) delete data[prop];
    }

    data.domain = getBaseDomain(data.domain);

    //ensure the default value to some props
    if (!isNumber(data.stateCode)) data.stateCode = 0;
    if (!isNumber(data.statusCode)) data.statusCode = 0;
    data.solutionId = solution.id;

    //Take care of props for search content
    entity = getEntity(solution, entityName, entityType);
    if (entity) {
        data.searchDisplay = generateSearchDisplay(entity, data);
        data.searchContent = generateSearchContent(entity, data);
    }

    if (data.firstName || data.lastName) {
        data.fullName = getRecordFullName(data, true);
    }

    switch (entityName) {
        case 'Organization':
            {
                data.organizationId = data.id;
                break;
            }
        default:
            {
                data.organizationId = context.organizationId || user.organizationId;
                break;
            }
    }

    if (!isNonEmptyString(data.organizationId)) {
        throw 'Missing organizationId.';
    }

    const utcNow = utcISOString();

    data.modifiedBy = user.id;
    data.modifiedOn = utcNow;
    if (data.isGlobal && !data.isGlobalOn) data.isGlobalOn = utcNow;

    if (isNew) {
        data.id = newGuid();
        data.createdBy = user.id;
        data.createdOn = utcNow;
        data.ownedBy = user.id;
        data.ownedOn = utcNow;
    }
    else {
        if (!data.createdBy) data.createdBy = user.id;
        if (!data.createdBy) data.createdOn = utcNow;
        if (!data.ownedBy) data.ownedBy = user.id;
        if (!data.ownedOn) data.ownedOn = utcNow;
    }

    data.display = getRecordDisplay(data);
    data.abstract = getRecordAbstract(data);


    let tags = data.tags;

    if (isNonEmptyString(tags)) tags = tags.split(',');

    if (isArray(tags)) {
        tags = without(map(tags, tag => {
            if (isString(tag)) {
                return tag.trim().length > 0 ? tag.trim() : null;
            }
            else {
                return tag; //this maybe the special tags in entity such as organization
            }
        }), null);

        data.tags = tags;
    }

    if (!isNonEmptyString(data.partitionKey)) {
        data.partitionKey = data.organizationId;
    }

    //remove props that can not be updated from API
    delete data.system;

    //apply slug
    const { slug, slugs } = applyRecordSlug(data);
    data.slug = slug;
    data.slugs = slugs;

    //tags need all trimed
    data.tags = isArray(data.tags) ? map(data.tags, (tag) => {
        if (isObject(tag)) {
            // tag.data = isArray(tag.data) ? map(tag.data, (d) => {
            //     return d.trim();
            // }) : [];
            return tag.text;
        }
        else {
            return tag.trim();
        }
    }) : [];

    //if there's tags, we will need a duplicated tagsLowerCase for search
    data.tagsLowerCase = isArray(data.tags) ? map(data.tags, (tag) => {
        if (isObject(tag)) {
            // tag.data = isArray(tag.data) ? map(tag.data, (d) => {
            //     return d.toLowerCase();
            // }) : [];
            // return tag;
            return tag.text.toLowerCase();
        }
        else {
            return tag.toLowerCase();
        }
    }) : [];


    if (!isNumber(data.prevPrice)) data.prevPrice = data.currentPrice;

    if (!isNew && !skipExistingData) {

        const existingData: any = await cosmosDBRetrieveById(data.id);

        if (existingData) {

            data = handlePrices(data, existingData);

            //the fields below can not be changed from update
            data.system = existingData.system;
            data.entityName = existingData.entityName;
            data.partitionKey = existingData.partitionKey;

            //emailVerificationCode and mobileVerificationCode can not be updated by the normal update function
            //it will be updated by special functions such as activate user
            data.emailVerificationCode = existingData.emailVerificationCode;
            data.mobileVerificationCode = existingData.mobileVerificationCode;

            data.statusCode = existingData.statusCode;
            data.stateCode = existingData.stateCode;

            //The licenses and roles field can not be updated in Organization and User Record
            //There are different function to update these values
            if (!skipSystemPropertyCheck && (data.entityName == "Organization" || data.entityName == "User")) {
                data.licenses = existingData.licenses;
                data.roles = existingData.roles;
            }

            if (existingData.isGlobal != true && data.isGlobal == true) {
                data.isGlobalOn = utcISOString();
                data.isGlobalBy = user.id;
            }

            if (existingData.isGlobal == true && data.isGlobal != true) {
                delete data.isGlobalOn;
                delete data.isGlobalBy;
            }

            if (existingData.isPublished != true && data.isPublished == true) {
                data.publishedOn = utcISOString();
                data.publishedBy = user.id;
            }

            if (existingData.isPublished == true && data.isPublished != true) {
                delete data.isPublishedOn;
                delete data.isPublishedBy;
            }
        }
        else {
            if (updateOnly) {
                throw {
                    ...HTTPERROR_400,
                    type: ERROR_PARAMETER_INVALID,
                    source,
                    detail: {
                        reason: 'The record does (data.id) does not exist.',
                        parameters: { data }
                    }
                }
            }
        }

    }

    if (data.isGlobal == true) {
        if (!data.isGlobalOn) data.isGlobalOn = utcISOString();
        if (!data.isGlobalBy) data.isGlobalBy = user.id;
        data.isGlobalOrderBy = data.isGlobalOn ? data.isGlobalOn : data.createdOn;
    }

    if (data.isPublished == true) {
        if (!data.publishedOn) data.publishedOn = utcISOString();
        if (!data.publishedBy) data.publishedBy = user.id;
    }

    if (!skipDuplicationCheck) {
        const checkDuplicationResult = await checkDuplication(data, isNew);
        if (checkDuplicationResult) throw checkDuplicationResult;
    }


    if (_track) console.log({ processUpsertData: JSON.stringify(data) });

    return data;
};

export const handlePrices = (data: Record<string, any>, existingData: Record<string, any>) => {
    if (!isNumber(data.currentPrice)) {
        delete data.currentPrice;
        delete data.prevPrice;
        delete data.currentPriceChangedOn;
        return data;
    }

    if (isNumber(data.currentPrice) && isNumber(existingData.currentPrice)) {
        if (data.currentPrice != existingData.currentPrice) {
            data.currentPriceChangedOn = utcISOString();
            data.prevPrice = existingData.currentPrice;
        }
    }


    return data;

}

export const checkDuplication = async (data: Record<string, any>, isNew: boolean) => {

    const entityType = data.entityType;
    const entityName = data.entityName;
    const entity = getEntity(entityName, entityType);

    if (!entity) return null;

    //check duplication record
    if (isObject(entity) && isNonEmptyString(entity.duplicationCheckPropName)) {
        const newValue = data[entity.duplicationCheckPropName];
        if (isNil(newValue)) {
            return {
                name: 'ERROR_API_DUPLICATION_CHECK_MISSING_VALUE',
                detail: { propName: entity.duplicationCheckPropName }
            }
        }

        const resultDuplicationCheck = await cosmosDBQuery(`
            SELECT COUNT(0) count
            FROM c 
            WHERE c.entityName=@entityName 
            ${isNonEmptyString(data.entityType) ? 'AND c.entityType=@entityType' : ''}
            AND c.organizationId=@organizationId 
            ${isNew ? '' : 'AND c.id!=@id'}
            AND c.${entity.duplicationCheckPropName} = @newValue
        `,
            [
                {
                    name: '@organizationId',
                    value: data.organizationId
                },
                {
                    name: '@entityName',
                    value: data.entityName
                },
                {
                    name: '@entityType',
                    value: data.entityType
                },
                {
                    name: '@id',
                    value: data.id
                },
                {
                    name: `@newValue`,
                    value: newValue
                }
            ]);
        if (resultDuplicationCheck[0].count > 0) {
            return {
                name: 'ERROR_API_DUPLICATION_CHECK_FAILED',
                detail: { propName: entity.duplicationCheckPropName }
            }
        }
    }

    return null;
}

export const generateSearchContent = (entity: Record<string, any>, data: Record<string, any>) => {

    let searchFields = entity && isArray(entity.searchContentFields) ? entity.searchContentFields : [];

    //if there's no searchFields definition in the solution profile
    //the following default fields will be used
    if (searchFields.length == 0) {
        searchFields = [
            { name: 'description', type: 'text' },
            { name: 'note', type: 'text' },
            { name: 'content', type: 'text' },
            { name: 'summary', type: 'text' },
            { name: 'introduction', type: 'text' },
            { name: 'abstract', type: 'text' },
        ];
    }

    //generate searchContent value
    return mergeSearchFieldContent(data, searchFields);
};

export const generateSearchDisplay = (entity: Record<string, any>, data: Record<string, any>) => {

    let searchFields = entity && isArray(entity.searchDisplayFields) ? entity.searchDisplayFields : [];

    //if there's no searchFields definition in the solution profile
    //the following default fields will be used
    if (searchFields.length == 0) {
        searchFields = [
            { name: 'title', type: 'text' },
            { name: 'firstName', type: 'text' },
            { name: 'lastName', type: 'text' },
            { name: 'name', type: 'text' }
        ];
    }

    //generate searchContent value
    return mergeSearchFieldContent(data, searchFields);
};

export const mergeSearchFieldContent = (data: Record<string, any>, searchFields: Array<Record<string, any>>) => {

    const result = without(map(searchFields, (searchField) => {
        const type = isNonEmptyString(searchField.type) ? searchField.type : 'text';
        const name = searchField.name;
        if (!isNonEmptyString(name)) return null;
        switch (type.toLowerCase()) {
            case 'text':
                {
                    return isNonEmptyString(data[name]) ? data[name] : null;
                }
            default:
                {
                    return isNonEmptyString(data[name]) ? data[name] : null;
                }
        }
    }), null).join(' ');

    return cleanHTML(result, { bodyOnly: true, returnContent: 'text' });

};
