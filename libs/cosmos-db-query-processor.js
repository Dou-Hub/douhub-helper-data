
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

import _ from '../to-review/base';
import { HTTPERROR_403 } from '../../shared/util/constants';
import { checkEntityPrivilege } from '../../shared/util/auth';
import { solution } from '../../shared/metadata/solution';

const DEFAULT_LOOKUP_ATTRIBUTES = 'id,avatar,firstName,lastName,fullName,name,title,display,text';

// !!!!!!!!!!!!!!!!!!
// If you change logic here for cosmosDB query, please remember to make same change to elastic-search-query-processor.js


//Process query, add security conditions and generate costmosDB query format
export const processQuery = (context, req, skipSecurityCheck) => {

    if (!_.isObject(req)) req = {};
    req.conditions = _.isArray(req.conditions) ? req.conditions : [];

    //if it has id but empty string, we will give a ramdon id, so it will return nothing
    if (_.isString(req.id) && req.id.trim().length == 0) req.id = _.newGuid();

    //if it has ids but empty array, we will give a ramdon ids, so it will return nothing
    if (_.isNonEmptyString(req.ids)) req.ids = req.ids.split(',');
    if (_.isArray(req.ids) && req.ids.length == 0) req.ids = [_.newGuid()];

    if (req.lookup === true) {
        req.attributes = DEFAULT_LOOKUP_ATTRIBUTES;
    }

    if (_.isNonEmptyString(req.lookup)) {
        req.attributes = _.unionBy(req.lookup.split(','), DEFAULT_LOOKUP_ATTRIBUTES.split(',')).join(',');
    }

    const entityType = req.entityType;
    const entityName = req.entityName;

    if (!_.isNonEmptyString(entityName) && (!_.isArray(req.ids) && !_.isNonEmptyString(req.id) && !_.isNonEmptyString(req.slug))) {
        if (_.trackLibs) console.log({ req: JSON.stringify(req) });
        throw 'The entityName, ids or id is not provided.';
    }


    //check basic privilege
    if (req.scope != 'global' && !skipSecurityCheck && !checkEntityPrivilege(context, entityName, entityType, 'read')) {
        if (_.trackLibs) console.log({ name: 'processQuery.checkEntityPrivilege', entityName, entityType });
        throw HTTPERROR_403;
    }

    //Handle the pageSize setting for the query
    //Max: 150, Default: 10
    if (!_.isNumber(req.pageSize)) req.pageSize = 20;
    if (req.pageSize > 150) req.pageSize = 150;

    //convert attribues into a comma delimited string or *
    if (_.trackLibs) console.log({ action: 'handleAttributes', req: JSON.stringify(req) });
    req = handleAttributes(req);

    req.parameters = [
        { name: `@organizationId`, value: context.organizationId },
        { name: `@userId`, value: context.userId },
        { name: `@solutionId`, value: solution.id }
    ];

    req.query = `SELECT ${req.attributes} FROM c WHERE `;

    req = handleIdCondition(req);
    req = handleIdsCondition(req);
    req = handleSlugCondition(req);

    if (_.isNonEmptyString(entityName)) req.conditions.push({ attribute: 'entityName', op: '=', value: req.entityName });
    if (_.isNonEmptyString(entityType)) req.conditions.push({ attribute: 'entityType', op: '=', value: req.entityType });
    if (_.isNonEmptyString(req.keywords)) req.conditions.push({ attribute: 'search', op: 'search', value: req.keywords.toLowerCase() });
    if (_.isNonEmptyString(req.ownedBy)) req.conditions.push({ attribute: 'ownedBy', op: '=', value: req.ownedBy });
    if (_.isNonEmptyString(req.regardingId)) req.conditions.push({ attribute: 'regardingId', op: '=', value: req.regardingId });

    req = handleSolutionConditions(req);

    req = handleCategoryConditions(req);
    req = handleTagConditions(req);
    req = handleScopeCondition(req);

    if (!skipSecurityCheck) req = handleSecurityConditions(req);

    req = groupConditions(req);
    req = handleOrderBy(req);

    if (_.trackLibs) console.log({ req: JSON.stringify(req) });

    return req;
};

export const groupConditions = (req) => {

    for (var i = 0; i < req.conditions.length; i++) {
        //conditions can be object or string
        if (_.isObject(req.conditions[i])) {
            const paramName = `@p${_.newGuid().replace(/-/g, '')}`;
            const paramValue = req.conditions[i].value ? req.conditions[i].value : '';
            req.parameters.push({ name: paramName, value: paramValue });

            const attribute = _.isNonEmptyString(req.conditions[i].attribute) ? 'c.' + req.conditions[i].attribute : '';
            const op = _.isNonEmptyString(req.conditions[i].op) ? req.conditions[i].op.toUpperCase() : '';

            if (attribute.length > 0) {
                switch (op) {
                    case 'SEARCH':
                        {
                            req.conditions[i] = `(CONTAINS(LOWER(c.searchDisplay), ${paramName}) OR CONTAINS(LOWER(c.searchContent), ${paramName}))`;
                            break;
                        }
                    case 'CONTAINS':
                        {
                            req.conditions[i] = `${op}(${attribute}, ${paramName})`;
                            break;
                        }
                    default:
                        {
                            req.conditions[i] = `${attribute} ${op} ${paramName}`;
                            break;
                        }
                }
            }


        }

        req.query = i == 0 ? `${req.query} (${req.conditions[i]}) ` : `${req.query} and (${req.conditions[i]})`;
    }

    return req;
};

export const handleCategoryConditions = (req) => {
    req = handleCategoryConditionsBase(req, 'categoryIds');
    req = handleCategoryConditionsBase(req, 'globalCategoryIds');
    return req;
};

export const handleCategoryConditionsBase = (req, categoryIdsFieldName) => {

    const categoryIds = req[categoryIdsFieldName];
    if (!_.isArray(categoryIds) || _.isArray(categoryIds) && categoryIds.length == 0) return req;

    let condition = '';
    for (var i = 0; i < categoryIds.length; i++) {

        const categoryId = categoryIds[i];
        const paramName = categoryIdsFieldName + _.newGuid().replace(/-/g, '');

        if (i == 0) {
            condition = categoryId == 'mine' ? `NOT IS_DEFINED(c.${categoryIdsFieldName})` : `ARRAY_CONTAINS(c.${categoryIdsFieldName},@${paramName})`;
        }
        else {
            condition = categoryId == 'mine' ? `${condition} or NOT IS_DEFINED(c.${categoryIdsFieldName})` : `${condition} or ARRAY_CONTAINS(c.${categoryIdsFieldName},@${paramName})`;
        }

        req.parameters.push({ name: `@${paramName}`, value: categoryId });
    }
    req.conditions.push(condition);

    return req;
};

export const handleTagConditions = (req) => {
    const tags = req.tags;
    if (!_.isArray(tags) || _.isArray(tags) && tags.length == 0) return req;

    let condition = '';
    for (var i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const paramId = _.newGuid().replace(/-/g, '');
        if (i == 0) {
            condition = `ARRAY_CONTAINS(c.tagsLowerCase , @tag${paramId})`;
        }
        else {
            condition = `${condition} or ARRAY_CONTAINS(c.tagsLowerCase ,@tag${paramId})`;
        }

        req.parameters.push({ name: `@tag${paramId}`, value: tag.toLowerCase() });
    }
    req.conditions.push(condition);

    return req;
};

export const handleSecurityConditions = (req) => {
    req = handleSecurityCondition_Scope(req);
    return req;
};

export const handleSecurityCondition_Scope = (req) => {

    if (req.entityName == 'Secret') return req;

    req.scope = _.isNonEmptyString(req.scope) ? req.scope : 'organization';
    switch (req.scope.toLowerCase()) {
        case 'global':
        case 'mine':
        case 'global-and-mine':
            {
                //has been handled by handleScopeCondition function
                break;
            }
        default: // 'organization':
            {
                req.conditions.push('c.organizationId = @organizationId');
                break;
            }
    }

    return req;
};

export const handleSolutionConditions = (req) => {

    if (
        req.entityName == 'SolutionDashboard' ||
        req.entityName == 'Site' ||
        req.entityName == 'Localization' ||
        req.entityName == 'SolutionDefinition') {
        req.conditions.push('c.ownerId = @solutionId');
    }
    return req;
};

export const handleScopeCondition = (req) => {

    req.scope = _.isNonEmptyString(req.scope) ? req.scope.toLowerCase() : '';

    switch (req.scope) {
        case 'global':
            {
                req.conditions.push('c.isGlobal');
                break;
            }
        case 'mine':
            {
                req.conditions.push('c.ownedBy=@userId');
                break;
            }
        case 'global-and-mine':
            {
                req.conditions.push('c.ownedBy=@userId or c.isGlobal and c.ownedBy!=@userId');
                break;
            }
        case 'organization':
            {
                req.conditions.push('c.organizationId = @organizationId');
                break;
            }
        default:
            {
                break;
            }
    }

    return req;
};

export const handleIdCondition = (req) => {
    if (!_.isNonEmptyString(req.id)) return req;
    const paramId = _.newGuid().replace(/-/g, '');
    req.parameters.push({ name: `@id${paramId}`, value: req.id });
    req.conditions.push(`c.id = @id${paramId}`);

    return req;
};

export const handleIdsCondition = (req) => {
    if (!req.ids) return req;

    if (_.isNonEmptyString(req.ids)) req.ids = req.ids.split(',');

    if (_.isArray(req.ids) && req.ids.length > 0) {
        let condition = null;

        for (var i = 0; i < req.ids.length; i++) {
            const paramId = _.newGuid().replace(/-/g, '');
            if (i == 0) {
                condition = `c.id IN (@id${paramId}`;
            }
            else {
                condition = `${condition} ,@id${paramId}`;
            }
            if (i == req.ids.length - 1) condition = `${condition})`;
            req.parameters.push({ name: `@id${paramId}`, value: req.ids[i] });
        }

        req.conditions.push(condition);
    }

    return req;
};

export const handleSlugCondition = (req) => {
    if (!_.isNonEmptyString(req.slug)) return req;
    const paramId = _.newGuid().replace(/-/g, '');
    req.parameters.push({ name: `@id${paramId}`, value: req.slug });
    req.conditions.push(`ARRAY_CONTAINS(c.slugs, @id${paramId})`);

    return req;
};

export const handleAttributes = (req) => {

    let attributes = '*';
    if (req.attributes=='count') attributes = 'COUNT(0)';

    if (_.isArray(req.attributes)) req.attributes = req.attributes.join(',');
   
    if (_.isNonEmptyString(req.attributes) && req.attributes != "*" && req.attributes != "count") {

        if (`,${req.attributes},`.indexOf(",id,") < 0) req.attributes = req.attributes + ",id";
        //there are some system attributes that are required to make privilege check
        if (`,${req.attributes},`.indexOf(",organizationId,") < 0) req.attributes = req.attributes + ",organizationId";
        if (`,${req.attributes},`.indexOf(",ownedBy,") < 0) req.attributes = req.attributes + ",ownedBy";
        if (`,${req.attributes},`.indexOf(",entityName,") < 0) req.attributes = req.attributes + ",entityName";
        if (`,${req.attributes},`.indexOf(",entityType,") < 0) req.attributes = req.attributes + ",entityType";
        if (`,${req.attributes},`.indexOf(",security,") < 0) req.attributes = req.attributes + ",security";
        req.attributes = req.attributes.split(",");
    }

    if (_.isArray(req.attributes) && req.attributes.length > 0) {
        if (req.attributes.length > 1 || req.attributes.length == 1 && req.attributes[0] != '*') {
            attributes = `c.${req.attributes[0]}`;
            for (var i = 1; i < req.attributes.length; i++) {
                attributes = `${attributes},c.${req.attributes[i]}`;
            }
        }
    }

    if (_.trackLibs) console.log({ attributes });

    req.attributes = attributes;

    return req;
};

export const handleOrderBy = (req) => {

    if (_.isNonEmptyString(req.orderBy)) {
        const orderByInfo = req.orderBy.replace(/,/g, ' ').replace(/[ ]{2,}/gi, ' ').trim().split(' ');
        req.orderBy = [{ attribute: orderByInfo[0], type: orderByInfo.length <= 1 ? 'asc' : (orderByInfo.length > 1 && orderByInfo[1].toLowerCase() == 'desc' ? 'desc' : 'asc') }];
    }

    let orderBy = '';

    if (_.isArray(req.orderBy) && req.orderBy.length > 0) {
        _.each(req.orderBy, (o) => {
            if (!_.isNonEmptyString(o.type)) o.type = 'asc';
            o.type = o.type.toLowerCase() == 'desc' ? 'desc' : 'asc';

            orderBy = orderBy.length == 0 ? `order by c.${o.attribute} ${o.type}` : `${orderBy}, c.${o.attribute} ${o.type}`;
        });

        req.query = `${req.query} ${orderBy}`;
    }

    return req;
};
