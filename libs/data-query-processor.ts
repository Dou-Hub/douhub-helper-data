//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import { isString, isArray, unionBy, isNumber, each, isNil, isInteger } from 'lodash';
import { isObject, newGuid, isNonEmptyString, _track, checkEntityPrivilege } from 'douhub-helper-util';
import { HTTPERROR_403 } from 'douhub-helper-lambda';
import { DEFAULT_LOOKUP_ATTRIBUTES } from 'douhub-helper-service';

// !!!!!!!!!!!!!!!!!!
// If you change logic here for cosmosDB query, please remember to make same change to elastic-search-query-processor.js


//Process query, add security conditions and generate costmosDB query format
export const processQuery = (context: Record<string, any>, req?: Record<string, any>, skipSecurityCheck?: boolean): Record<string, any> => {

    const { solution } = context;

    req = !isNil(req) ? req : {};
    req.conditions = isArray(req.conditions) ? req.conditions : [];

    //if it has id but empty string, we will give a ramdon id, so it will return nothing
    if (isString(req.id) && req.id.trim().length == 0) req.id = newGuid();

    //if it has ids but empty array, we will give a ramdon ids, so it will return nothing
    if (isNonEmptyString(req.ids)) req.ids = req.ids.split(',');
    if (isArray(req.ids) && req.ids.length == 0) req.ids = [newGuid()];

    if (req.lookup === true) {
        req.attributes = DEFAULT_LOOKUP_ATTRIBUTES.split(',');
    }

    if (isNonEmptyString(req.lookup)) {
        req.attributes = unionBy(req.lookup.split(','), DEFAULT_LOOKUP_ATTRIBUTES.split(',')).join(',');
    }

    const entityType = req.entityType;
    const entityName = req.entityName;

    if (!isNonEmptyString(entityName) && (!isArray(req.ids) && !isNonEmptyString(req.id) && !isNonEmptyString(req.slug))) {
        if (_track) console.log({ req: JSON.stringify(req) });
        throw 'The entityName, ids or id is not provided.';
    }


    //check basic privilege
    if (req.scope != 'global' && !skipSecurityCheck && !checkEntityPrivilege(context, entityName, entityType, 'read')) {
        if (_track) console.log({ name: 'processQuery.checkEntityPrivilege', entityName, entityType });
        throw HTTPERROR_403;
    }

    //Handle the pageSize setting for the query
    //Max: 150, Default: 10
    if (!isNumber(req.pageSize)) req.pageSize = 20;
    if (req.pageSize > 150) req.pageSize = 150;

    //convert attribues into a comma delimited string or *
    if (_track) console.log({ action: 'handleAttributes', req: JSON.stringify(req) });
    req = handleAttributes(req);

    req.parameters = [
        { name: `@organizationId`, value: context.organizationId },
        { name: `@userId`, value: context.userId },
        { name: `@solutionId`, value: context.solutionId }
    ];

    req.query = `SELECT ${isInteger(req.top) ? `TOP ${req.top}` : ''} ${req.attributes} FROM c WHERE `;

    req = handleIdCondition(req);
    req = handleIdsCondition(req);
    req = handleSlugCondition(req);

    if (isNonEmptyString(entityName)) req.conditions.push({ attribute: 'entityName', op: '=', value: req.entityName });
    if (isNonEmptyString(entityType)) req.conditions.push({ attribute: 'entityType', op: '=', value: req.entityType });
    if (isNonEmptyString(req.keywords)) req.conditions.push({ attribute: 'search', op: 'search', value: req.keywords.toLowerCase() });
    if (isNonEmptyString(req.ownedBy)) req.conditions.push({ attribute: 'ownedBy', op: '=', value: req.ownedBy });
    if (isNonEmptyString(req.regardingId)) req.conditions.push({ attribute: 'regardingId', op: '=', value: req.regardingId });

    // req = handleSolutionConditions(req);

    req = handleCategoryConditions(req);
    req = handleTagConditions(req);
    req = handleScopeCondition(req);

    req = groupConditions(req);
    req = handleOrderBy(req);

    if (_track) console.log({ req: JSON.stringify(req) });

    return req;
};

export const groupConditions = (req: Record<string, any>): Record<string, any> => {

    for (var i = 0; i < req.conditions.length; i++) {
        //conditions can be object or string
        if (isObject(req.conditions[i])) {
            const paramName = `@p${newGuid().replace(/-/g, '')}`;
            const paramValue = !isNil(req.conditions[i].value) ? req.conditions[i].value : '';
            req.parameters.push({ name: paramName, value: paramValue });

            const attribute = isNonEmptyString(req.conditions[i].attribute) ? 'c.' + req.conditions[i].attribute : '';
            const op = isNonEmptyString(req.conditions[i].op) ? req.conditions[i].op.toUpperCase() : '';

            if (attribute.length > 0) {
                switch (op) {
                    case 'SEARCH':
                        {
                            req.conditions[i] = `(CONTAINS(LOWER(c.searchDisplay), ${paramName}) OR CONTAINS(LOWER(c.searchContent), ${paramName}))`;
                            break;
                        }
                    case 'ARRAY_CONTAINS':
                        {
                            req.conditions[i] = `ARRAY_CONTAINS(${attribute}, ${paramName})`;
                            break;
                        }
                    case 'NOT_ARRAY_CONTAINS':
                        {
                            req.conditions[i] = `NOT ARRAY_CONTAINS(${attribute}, ${paramName})`;
                            break;
                        }
                    case 'NOT_IN':
                    case 'IN':
                        {
                            if (isArray(req.paramValues) && req.paramValues.length > 0) {
                                let condition = '';

                                for (var i = 0; i < req.ids.length; i++) {
                                    if (i == 0) {
                                        condition = `${attribute} ${op == 'NOT_IN' ? 'NOT IN' : 'IN'} (${paramName}${i}`;
                                    }
                                    else {
                                        condition = `${condition} ,${paramName}${i}`;
                                    }
                                    if (i == req.paramValues.length - 1) condition = `${condition})`;
                                    req.parameters.push({ name: `${paramName}${i}`, value: req.paramValues[i] });
                                }

                                req.conditions[i] = condition;
                            }
                            break;
                        }
                    case 'NOT_CONTAINS':
                        {
                            req.conditions[i] = `NOT CONTAINS(${attribute}, ${paramName})`;
                            break;
                        }
                    case 'CONTAINS':
                        {
                            req.conditions[i] = `CONTAINS(${attribute}, ${paramName})`;
                            break;
                        }
                    case 'NOT_IS_DEFINED':
                        {
                            req.conditions[i] = `NOT IS_DEFINED(${attribute})`;
                            break;
                        }
                    case 'IS_DEFINED':
                        {
                            req.conditions[i] = `IS_DEFINED(${attribute})`;
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

export const handleCategoryConditions = (req: Record<string, any>): Record<string, any> => {
    req = handleCategoryConditionsBase(req, 'categoryIds');
    req = handleCategoryConditionsBase(req, 'globalCategoryIds');
    return req;
};

export const handleCategoryConditionsBase = (req: Record<string, any>, categoryIdsFieldName: string): Record<string, any> => {

    const categoryIds = req[categoryIdsFieldName];
    if (!isArray(categoryIds) || isArray(categoryIds) && categoryIds.length == 0) return req;

    let condition = '';
    for (var i = 0; i < categoryIds.length; i++) {

        const categoryId = categoryIds[i];
        const paramName = categoryIdsFieldName + newGuid().replace(/-/g, '');

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


export const handleTagConditions = (req: Record<string, any>): Record<string, any> => {
    const tags = req.tags;
    if (!isArray(tags) || isArray(tags) && tags.length == 0) return req;

    let condition = '';
    for (var i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const paramId = newGuid().replace(/-/g, '');
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

export const handleScopeCondition = (req: Record<string, any>): Record<string, any> => {

    req.scope = isNonEmptyString(req.scope) ? req.scope.toLowerCase() : '';

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
        case 'global-or-organization':
            {
                req.conditions.push('c.isGlobal OR c.organizationId = @organizationId');
                break;
            }
        case 'global-and-mine':
            {
                req.conditions.push('c.ownedBy=@userId OR c.isGlobal and c.ownedBy!=@userId');
                break;
            }
        case 'membership':
            {
                if (isNonEmptyString(req.recordIdForMembership)) {
                    req.conditions.push(`c.organizationId = @organizationId AND IS_DEFINED(c.membership) AND IS_DEFINED(c.membership["${req.recordIdForMembership}"])`);
                }
                else {
                    req.conditions.push('c.organizationId = @organizationId');
                }

                break;
            }
        default:
            {
                req.conditions.push('c.organizationId = @organizationId');
                break;
            }
    }

    return req;
};

export const handleIdCondition = (req: Record<string, any>): Record<string, any> => {
    if (!isNonEmptyString(req.id)) return req;
    const paramId = newGuid().replace(/-/g, '');
    req.parameters.push({ name: `@id${paramId}`, value: req.id });
    req.conditions.push(`c.id = @id${paramId}`);

    return req;
};

export const handleIdsCondition = (req: Record<string, any>): Record<string, any> => {
    if (!req.ids) return req;

    if (isNonEmptyString(req.ids)) req.ids = req.ids.split(',');

    if (isArray(req.ids) && req.ids.length > 0) {
        let condition = '';

        for (var i = 0; i < req.ids.length; i++) {
            const paramId = newGuid().replace(/-/g, '');
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

export const handleSlugCondition = (req: Record<string, any>): Record<string, any> => {
    if (!isNonEmptyString(req.slug)) return req;
    const paramId = newGuid().replace(/-/g, '');
    req.parameters.push({ name: `@id${paramId}`, value: req.slug });
    req.conditions.push(`ARRAY_CONTAINS(c.slugs, @id${paramId})`);

    return req;
};

export const handleAttributes = (req: Record<string, any>): Record<string, any> => {

    let attributes = '*';
    if (req.attributes == 'count') attributes = 'COUNT(0)';

    if (isArray(req.attributes)) req.attributes = req.attributes.join(',');

    if (isNonEmptyString(req.attributes) && req.attributes != "*" && req.attributes != "count") {

        if (`,${req.attributes},`.indexOf(",id,") < 0) req.attributes = req.attributes + ",id";
        //there are some system attributes that are required to make privilege check
        if (`,${req.attributes},`.indexOf(",organizationId,") < 0) req.attributes = req.attributes + ",organizationId";
        if (`,${req.attributes},`.indexOf(",ownedBy,") < 0) req.attributes = req.attributes + ",ownedBy";
        if (`,${req.attributes},`.indexOf(",entityName,") < 0) req.attributes = req.attributes + ",entityName";
        if (`,${req.attributes},`.indexOf(",entityType,") < 0) req.attributes = req.attributes + ",entityType";
        if (`,${req.attributes},`.indexOf(",security,") < 0) req.attributes = req.attributes + ",security";
        req.attributes = req.attributes.split(",");
    }

    if (isArray(req.attributes) && req.attributes.length > 0) {
        if (req.attributes.length > 1 || req.attributes.length == 1 && req.attributes[0] != '*') {
            attributes = `c.${req.attributes[0]}`;
            for (var i = 1; i < req.attributes.length; i++) {
                attributes = `${attributes},c.${req.attributes[i]}`;
            }
        }
    }

    if (_track) console.log({ attributes });

    req.attributes = attributes;

    return req;
};

export const handleOrderBy = (req: Record<string, any>): Record<string, any> => {

    if (isNonEmptyString(req.orderBy)) {
        const orderByInfo = req.orderBy.replace(/,/g, ' ').replace(/[ ]{2,}/gi, ' ').trim().split(' ');
        req.orderBy = [{ attribute: orderByInfo[0], type: orderByInfo.length <= 1 ? 'asc' : (orderByInfo.length > 1 && orderByInfo[1].toLowerCase() == 'desc' ? 'desc' : 'asc') }];
    }

    let orderBy = '';

    if (isArray(req.orderBy) && req.orderBy.length > 0) {
        each(req.orderBy, (o) => {
            if (!isNonEmptyString(o.type)) o.type = 'asc';
            o.type = o.type.toLowerCase() == 'desc' ? 'desc' : 'asc';

            orderBy = orderBy.length == 0 ? `order by c.${o.attribute} ${o.type}` : `${orderBy}, c.${o.attribute} ${o.type}`;
        });

        req.query = `${req.query} ${orderBy}`;
    }

    return req;
};
