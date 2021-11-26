
//  COPYRIGHT:       PrimeObjects Software Inc. (C) 2021 All Right Reserved
//  COMPANY URL:     https://www.primeobjects.com/
//  CONTACT:         developer@primeobjects.com
// 
//  This source is subject to the PrimeObjects License Agreements. 
// 
//  Our EULAs define the terms of use and license for each PrimeObjects product. 
//  Whenever you install a PrimeObjects product or research PrimeObjects source code file, you will be prompted to review and accept the terms of our EULA. 
//  If you decline the terms of the EULA, the installation should be aborted and you should remove any and all copies of our products and source code from your computer. 
//  If you accept the terms of our EULA, you must abide by all its terms as long as our technologies are being employed within your organization and within your applications.
// 
//  THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY
//  OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT
//  LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
//  FITNESS FOR A PARTICULAR PURPOSE.
// 
//  ALL OTHER RIGHTS RESERVED

import _ from './base';
import { checkEntityPrivilege, checkRecordPrivilege } from '../../shared/util/auth';
import { processQuery } from './libs/cosmos-db-query-processor';
import { processResult } from './libs/cosmos-db-result-processor';
import { cleanHTML, getBaseDomain } from '../../shared/util/web';
import { getEntity } from '../../shared/util/metadata';
import { solution } from '../../shared/metadata/solution';
import { HTTPERROR_403 } from '../../shared/util/constants';
import { getDisplay, getAbstract } from '../../shared/util/data';
import { applySlug } from '../util/data';

const DEFAULT_USER_ATTRS = 'id,avatar,firstName,lastName,title,company,introduction,media,url,twitter,icon';
const DEFAULT_LOOKUP_ATTRS = 'id,avatar,firstName,lastName,fullName,name,url,title,subject,display,text,media,twitter,icon';

export const retrieveRecord = async (context, ids, attributes, skipSecurityCheck, query) => {
    return await retrieveBase(context, ids, attributes, skipSecurityCheck, query);
};

//retrieve one or multiple records
export const retrieveBase = async (context, ids, attributes, skipSecurityCheck, query) => {

    query = _.isObject(query) ? query : {};
    query.ids = ids;
    query.attributes = attributes;
    query.ignorePage = true;

    if (_.trackLibs) console.log('retrieveBase', query);


    //For retrieve, we will retrive the record first without security check
    let result = await queryBase(context, query, true); //skipSecurityCheck=true

    if (_.track) console.log('retrieveBase', result);

    //Then we will check security based on the result, because result will has entityName, entityType, organizationId, 
    //Result has more attrs for security check
    if (!skipSecurityCheck && result.data.length > 0) {

        result.data = _.without(_.map(result.data, (data) => {
            if (data.isGlobal || skipSecurityCheck) return data;

            //check privilege, lookup request will not check privilege. the returned data properties are limited in cosmos-db-query-processor.js
            if (query.lookup != true && !checkRecordPrivilege(context, data, "read")) {
                if (_.track) console.log(`retrieveBase checkRecordPrivilege(context, data, "read")=false`);
                return null;
            }

            return data;
        }), null);
    }

    result.count == result.data.length;

    if (result.count == 0) {
        return _.isArray(ids) ? [] : null;
    }
    else {
        return _.isArray(ids) ? result.data : result.data[0];
    }

};


export const query = async (context, query, skipSecurityCheck) => {
    return await queryBase(context, query, skipSecurityCheck);
};

/*
    const data = await cosmosDb.query(context, 
    {
        query: "SELECT top 1 * FROM c WHERE  c.id = @id",
        parameters: [
        {
            name: "@id",
            value: "ad4d5afc-b92a-48a0-895f-67c9faf27363"
        }
        ]
    });
*/
export const queryBase = async (context, query, skipSecurityCheck) => {

    //Process the query and transform the query to the CosmosDb format
    query = processQuery(context, query, skipSecurityCheck);
    if (_.trackLibs) console.log({ processedQuery: query });
    return await queryRaw(context, query);
};

export const queryRaw = async (context, query) => {

    //const organizationId = context && _.isObject(context.organization) && context.organization.id ? context.organization.id : null;
    //const options = _.isNonEmptyString(organizationId) && !enableCrossPartitionQuery ? { partitionKey: organizationId } : { enableCrossPartitionQuery: true };
    //const options = { enableCrossPartitionQuery: true };
    // const scope = _.isNonEmptyString(query.scope) ? query.scope.toLowerCase() : '';
    // if (scope == 'global' || scope == 'global-and-mine') {
    //     options.enableCrossPartitionQuery = true;
    //     delete options.partitionKey;
    // }

    const pageSize = _.isNumber(query.pageSize) && query.pageSize >= 1 ? query.pageSize : 20;
    if (!_.isNumber(query.pageNumber)) query.pageNumber = 1;

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

    const response = (await _.cosmosDBQuery(query.query, query.parameters, { includeAzureInfo: true }));
    const results = response.resources;

    // if (_.trackLibs) console.log({ queryRaw: JSON.stringify(results) });

    //In some cases we will have to retrieve more data
    let data = await retrieveRelatedRecords(context, query, results);

    if (!_.isArray(data)) data = [];

    //process result
    data = processResult(context, data);

    const result = {
        _charge: _.isObject(response.headers) ? response.headers['x-ms-request-charge'] : 0,
        data,
        count: data.length
    };

    if (_.isNumber(continuation) && pageSize >= 1 && data.length == pageSize) {
        result.continuation = continuation + data.length;
    }
    if (_.trackLibs) console.log({ result });
    return result;


};

export const retrieveRelatedRecords = async (context, query, data) => {

    if (!_.isArray(data)) data = [];

    if (query.includeOwnerInfo) {

        let ownerAttrs = DEFAULT_USER_ATTRS;
        //includeOwnerInfo may be a list of attributes for the user records
        if (_.isString(query.includeOwnerInfo) && query.includeOwnerInfo.length > 0 && query.includeOwnerInfo != 'true') {
            ownerAttrs = query.includeOwnerInfo;
        }

        data = await retrieveRelatedRecordsBase(context, 'ownedBy', ownerAttrs.split(','), 'owner_info', data);
    }

    if (query.includeOrganizationInfo) {

        let orgAttrs = 'id,name,introduction';
        //includeOrganizationInfo may be a list of attributes for the org records
        if (_.isString(query.includeOrganizationInfo) && query.includeOrganizationInfo.length > 0) {
            orgAttrs = query.includeOrganizationInfo;
        }

        data = await retrieveRelatedRecordsBase(context, 'organizationId', orgAttrs.split(','), 'organization_info', data);
    }

    if (query.includeUserInfo) {

        let userAttrs = DEFAULT_USER_ATTRS;
        //includeUserInfo may be a list of attributes for the user records
        if (_.isString(query.includeUserInfo) && query.includeUserInfo.length > 0) {
            userAttrs = query.includeUserInfo;
        }

        data = await retrieveRelatedRecordsBase(context, 'userId', userAttrs.split(','), 'user_info', data);
    }

    const includeLookups = query.includeLookups;
    if (_.isArray(includeLookups) && includeLookups.length > 0) {

        for (var i = 0; i < includeLookups.length; i++) {
            if (_.isNonEmptyString(includeLookups[i].fieldName)) {
                let lookupAttrs = _.isNonEmptyString(includeLookups[i].attributes) ? includeLookups[i].attributes : DEFAULT_LOOKUP_ATTRS;
                data = await retrieveRelatedRecordsBase(context, includeLookups[i].fieldName, lookupAttrs.split(','), `${includeLookups[i].fieldName}_info`, data);
            }
        }
    }

    return data;
};

export const retrieveRelatedRecordsBase = async (context, idFieldName, resultFieldNames, objectFieldName, data) => {

    if (data.length == 0) return data;

    //we need get all ids 
    let ids = '';
    _.each(data, (r) => {
        const id = _.isArray(r[idFieldName]) ? (r[idFieldName].length > 0 ? r[idFieldName][0] : null) : r[idFieldName];
        if (_.isNonEmptyString(id) && ids.indexOf(id) < 0) {
            ids = ids.length == 0 ? `${id}` : `${ids},${id}`;
        }
    });

    if (ids.length > 0) {
        //retrieve all owner records
        const list = {};
        _.each(await retrieveRecord(context, ids.split(','), resultFieldNames, true, null, true), (r) => {
            list[r.id] = r;
        });

        data = _.each(data, (r) => {
            r[objectFieldName] = list[r[idFieldName]];
        });
    }

    return data;
};

export const createRecord = async (context, data, settings) => {

    if (!_.isObject(data)) throw new Error('ERROR_API_MISSING_PARAMETERS');

    const { userId } = context;
    const utcNow = _.utcISOString();

    if (!_.isObject(settings)) settings = {};
    const { skipSecurityCheck } = settings;

    data.createdBy = userId;
    data.createdOn = utcNow;
    data.ownedBy = userId;
    data.ownedOn = utcNow;

    if (!skipSecurityCheck) {
        const entityType = data.entityType;
        const entityName = data.entityName;

        if (!checkEntityPrivilege(context, entityName, entityType, 'create')) {
            throw HTTPERROR_403;
        }
    }

    return await upsertRecord(context, data, 'create');
};

export const deleteRecord = async (context, id, settings) => {

    if (!_.isNonEmptyString(id)) throw HTTPERROR_403;
    if (!_.isObject(settings)) settings = {};
    return await deleteRecordBase(context, await _.cosmosDBRetrieve(id), settings);
};


export const deleteRecordBase = async (context, data, settings) => {

    if (!_.isObject(data)) return data;

    if (!_.isObject(settings)) settings = {};
    const { skipSecurityCheck, skipAction } = settings;

    if (!skipSecurityCheck && !checkRecordPrivilege(context, data, 'delete')) {
        throw HTTPERROR_403;
    }

    await _.cosmosDBDelete(data);

    if (!skipAction) {
        const { userId, organizationId } = context;
        await _.sendAction('data', data, { name: 'delete', userId, organizationId });
    }
    return data;
};


//Update data is full record, otherwise use partialUpdate
export const updateRecord = async (context, data, settings) => {

    if (!_.isObject(settings)) settings = {};
    const { skipSecurityCheck } = settings;

    if (!_.isObject(data)) throw new Error('ERROR_API_MISSING_PARAMETERS', 'The parameter (data) is not provided.');
    if (!_.isNonEmptyString(data.id)) throw new Error('ERROR_API_MISSING_PARAMETERS', 'The parameter (data.id) is not provided.');

    if (!skipSecurityCheck && !checkRecordPrivilege(context, data, 'update')) {
        throw HTTPERROR_403;
    }


    return await upsertRecord(context, data, 'update');
};


export const partialUpdateRecord = async (context, data, settings) => {

    if (!_.isObject(data)) throw new Error('ERROR_API_MISSING_PARAMETERS');
    if (!_.isNonEmptyString(data.id)) throw new Error('ERROR_API_MISSING_PARAMETERS');

    //we will have to get the record first
    const result = await queryRaw(context, {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [
            {
                name: '@id',
                value: data.id
            }
        ]
    });

    if (result.data.length == 0) throw HTTPERROR_403;

    //MERGE DATA
    data = _.assign({}, result.data[0], data);

    return await updateRecord(context, data, settings);
};


//upsert will have no permission check, it is simply a base function to be called with fully trust
export const upsertRecord = async (context, data, actionName) => {

    if (!_.isObject(data)) throw 'Data is not provided.';

    //we will process data first 
    data = await processUpsertData(context, data);
    await _.cosmosDBUpsert(data);

    const { userId, organizationId } = context;
    await _.sendAction('data', data, { ignoreOrganizationId: true, ignoreUserId: true, name: actionName || 'upsert', userId, organizationId });

    return data;
};


export const processUpsertData = async (context, data, skipExistingData) => {

    const entityType = data.entityType;
    const entityName = data.entityName;
    const user = _.isObject(context.user) && context.user.id ? context.user : { id: context.userId };
    if (!_.isNonEmptyString(user.id)) throw 'There is no userId or user defined in the context.';
    const isNew = !_.isNonEmptyString(data.id);

    if (isNew) data.id = _.newGuid();

    let entity = {};

    //delete unsupported props
    delete data['_charge'];
    delete data.highlight;
    delete data.temp;
    delete data.token;
    //all xxx_info will not be allowed, because _info is system reserved for special query result
    for (var prop in data) {
        if (_.endsWith(prop, '_info')) delete data[prop];
    }

    data.domain = getBaseDomain(data.domain);

    //ensure the default value to some props
    if (!_.isNumber(data.stateCode)) data.stateCode = 0;
    if (!_.isNumber(data.statusCode)) data.statusCode = 0;
    data.solutionId = solution.id;


    //Take care of props for search content
    entity = getEntity(entityName, entityType);
    data.searchDisplay = generateSearchDisplay(entity, data);
    data.searchContent = generateSearchContent(entity, data);

    switch (entityName) {
        case 'Organization':
            {
                data.organizationId = data.id;
                //if (_.isObject(cx.secret.encryptionFeed) && !_.isNonEmptyString(data.token)) data.token = _.encrypt(`${data.id}.${_.utcMaxISOString().split('.')[0]}.${_.newGuid()}`, cx.secret.encryptionFeed.key, cx.secret.encryptionFeed.iv);
                //data.token = await _.createRecordToken(cx, data);
                break;
            }
        default:
            {
                data.organizationId = context.organizationId || user.organizationId;
                //if (_.isObject(cx.secret.encryptionFeed) && !_.isNonEmptyString(data.token)) data.token = _.encrypt(`${data.id}.${_.utcMaxISOString().split('.')[0]}.${_.newGuid()}`, cx.secret.encryptionFeed.key, cx.secret.encryptionFeed.iv);
                //data.token = await _.createRecordToken(cx, data);
                break;
            }
    }

    if (!_.isNonEmptyString(data.organizationId)) {
        throw 'Missing organizationId.';
    }

    const utcNow = _.utcISOString();

    data.modifiedBy = user.id;
    data.modifiedOn = utcNow;
    if (data.isGlobal && !data.isGlobalOn) data.isGlobalOn = utcNow;

    if (isNew) {
        data.id = _.newGuid();
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

    data.display = getDisplay(data);
    data.abstract = getAbstract(data);

    if (data.isGlobal && !data.isGlobalOn) data.isGlobalOn = _.utcISOString();
    data.isGlobalOrderBy = data.isGlobalOn ? data.isGlobalOn : data.createdOn;

    let tags = data.tags;

    if (_.isNonEmptyString(tags)) tags = tags.split(',');

    if (_.isArray(tags)) {
        tags = _.without(_.map(tags, tag => {
            if (_.isString(tag)) {
                return tag.trim().length > 0 ? tag.trim() : null;
            }
            else {
                return tag; //this maybe the special tags in entity such as organization
            }
        }), null);

        data.tags = tags;
    }

    if (!_.isNonEmptyString(data.partitionKey)) {
        data.partitionKey = data.organizationId;
    }

    //remove props that can not be updated from API
    delete data.system;

    //apply slug
    const { slug, slugs } = applySlug(data);
    data.slug = slug;
    data.slugs = slugs;

    //tags need all trimed
    data.tags = _.isArray(data.tags) ? _.map(data.tags, (tag) => {
        if (_.isObject(tag)) {
            // tag.data = _.isArray(tag.data) ? _.map(tag.data, (d) => {
            //     return d.trim();
            // }) : [];
            return tag.text;
        }
        else {
            return tag.trim();
        }
    }) : [];

    //if there's tags, we will need a duplicated tagsLowerCase for search
    data.tagsLowerCase = _.isArray(data.tags) ? _.map(data.tags, (tag) => {
        if (_.isObject(tag)) {
            // tag.data = _.isArray(tag.data) ? _.map(tag.data, (d) => {
            //     return d.toLowerCase();
            // }) : [];
            // return tag;
            return tag.text.toLowerCase();
        }
        else {
            return tag.toLowerCase();
        }
    }) : [];


    if (!_.isNumber(data.prevPrice)) data.prevPrice = data.currentPrice;

    if (!isNew && !skipExistingData) {

        const existingData = await _.cosmosDBRetrieve(data.id);

        if (existingData) {
            data.licenses = existingData.licenses;
            data.system = existingData.system;
            data.roles = existingData.roles;
            data.partitionKey = existingData.partitionKey;

            data = handlePrices(data, existingData);
        }
    }

    const checkDuplicationResult = await checkDuplication(data, isNew);
    
    if (checkDuplicationResult) throw checkDuplicationResult;

    if (_.trackLibs) console.log({ processUpsertData: JSON.stringify(data) });

    return data;
};

export const handlePrices = (data, existingData) => {
    if (!_.isNumber(data.currentPrice)) {
        delete data.currentPrice;
        delete data.prevPrice;
        delete data.currentPriceChangedOn;
        return data;
    }

    if (_.isNumber(data.currentPrice) && _.isNumber(existingData.currentPrice)) {
        if (data.currentPrice != existingData.currentPrice) {
            data.currentPriceChangedOn = _.utcISOString();
            data.prevPrice = existingData.currentPrice;
        }
    }


    return data;

}

export const checkDuplication = async (data, isNew) => {

    const entityType = data.entityType;
    const entityName = data.entityName;
    const entity = getEntity(entityName, entityType);

    //check duplication record
    if (_.isObject(entity) && _.isNonEmptyString(entity.duplicationCheckPropName)) {
        const newValue = data[entity.duplicationCheckPropName];
        if (_.isNil(newValue)) {
            return {
                name: 'ERROR_API_DUPLICATION_CHECK_MISSING_VALUE',
                detail: { propName: entity.duplicationCheckPropName }
            }
        }

        const resultDuplicationCheck = await _.cosmosDBQuery(`
            SELECT COUNT(0) count
            FROM c 
            WHERE c.entityName=@entityName 
            ${_.isNonEmptyString(data.entityType) ? 'AND c.entityType=@entityType' : ''}
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

export const generateSearchContent = (entity, data) => {

    let searchFields = entity && _.isArray(entity.searchContentFields) ? entity.searchContentFields : [];

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

export const generateSearchDisplay = (entity, data) => {

    let searchFields = entity && _.isArray(entity.searchDisplayFields) ? entity.searchDisplayFields : [];

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

export const mergeSearchFieldContent = (data, searchFields) => {

    const result = _.without(_.map(searchFields, (searchField) => {
        const type = _.isNonEmptyString(searchField.type) ? searchField.type : 'text';
        const name = searchField.name;
        if (!_.isNonEmptyString(name)) return null;
        switch (type.toLowerCase()) {
            case 'text':
                {
                    return _.isNonEmptyString(data[name]) ? data[name] : null;
                }
            default:
                {
                    return _.isNonEmptyString(data[name]) ? data[name] : null;
                }
        }
    }), null).join(' ');

    return cleanHTML(result, { bodyOnly: true, returnContent: 'text' });

};

export default { checkDuplication, retrieveRecord, query, retrieveRelatedRecords, createRecord, deleteRecord, upsertRecord, partialUpdateRecord, updateRecord, processUpsertData };