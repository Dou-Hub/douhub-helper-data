//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import { isEmpty, isNil, each, isArray, find, isFunction } from 'lodash';
import { isNonEmptyString, isObject, sameGuid, _track, isEmptyGuid, GUID_EMPTY, getEntity } from 'douhub-helper-util';

export const checkRecordPrivilege = (context: Record<string, any>, record: Record<string, any>, prType: string): boolean => {
    if (!isObject(record)) {
        if (_track) console.log('NO_RECORD');
        return false;
    }

    return checkPrivilege(context, undefined, undefined, record, prType);
};

export const isSolutionOwner = (context: Record<string, any>, record?:Record<string, any>): boolean => {

    const solutionId = context?.solutionId ?? context?.solution?.id;
    const ownedBy = isNonEmptyString(solutionId) && (context?.solution?.ownedBy);
   
    if (isNonEmptyString(solutionId) && record && record.solutionId!=solutionId) return false;
    return isNonEmptyString(ownedBy) && ownedBy == context.userId;
};

export const recordOwnedByUser = (user: Record<string, any>, record?: Record<string, any>): boolean => {
    const ownedBy = record?.ownedBy;
    const userId = user?.id;
    return isNonEmptyString(ownedBy) && isNonEmptyString(userId) && sameGuid(userId, ownedBy);
};

export const recordOwnedByOrganization = (user: Record<string, any>, record?: Record<string, any>): boolean => {
    const recordOrganizationId = record?.organizationId;
    const userOrganizationId = user?.organizationId;
    return isNonEmptyString(recordOrganizationId) && isNonEmptyString(userOrganizationId) && sameGuid(recordOrganizationId, userOrganizationId);
};


export const checkLicenses = (context: Record<string, any>, featureOrEntityName: string): boolean => {

    const trackPrefix = 'checkLicenses';
    
    if (isNil(context?.solution)) {
        if (_track) console.log(`${trackPrefix}.solutionNotFound`, { context, featureOrEntityName });
        return false;
    }

    if (isNil(context?.user)) {
        if (_track) console.log(`${trackPrefix}.userNotFound`, { context, featureOrEntityName });
        return false;
    }

    if (hasRole(context, 'SOLUTION-ADMIN')) return true;
   
    const { user, solution } = context;

    //Root Admin has all permission
    // if (isRootAdmin(context)) return true;

    if (!isNonEmptyString(featureOrEntityName)) {
        if (_track) console.log(`${trackPrefix}.noFeatureOrEntityName`);
        return false;
    }

    //Get solution licenses
    let solutionLicenses = solution.licenses;

    if (!isArray(solutionLicenses)) solutionLicenses = [];

    //If there's no license for the solution, we will not check the license
    if (isArray(solutionLicenses) && solutionLicenses.length == 0) return true;

     //If user has no license for user, we will try the default license in solution
    const userLicenses = isArray(user.licenses) ? user.licenses.slice() : [];
    each(solutionLicenses, (solutionLicense) => {
        //if there's default license, add it to userLicenses
        if (solutionLicense.isDefault === true) userLicenses.push(solutionLicense.name);
    });

    let pass = false;
    each(userLicenses, (userLicense) => {
        //only check if it does not pass
        if (!pass) {
            const solutionLicense = find(solutionLicenses, (l) => l.name.toLowerCase() === userLicense.toLowerCase());
            if (solutionLicense) {
                //pass if the user has the license and the license has feature that is featureOrEntityName
                pass = find(solutionLicense.features, (f) => f.trim().toLowerCase() === featureOrEntityName.trim().toLowerCase());
            }
        }
    });


    if (!pass && _track) console.log(`${trackPrefix}.noPass`, { userLicenses, featureOrEntityName });

    return pass;
};

export const hasLicense = (context: Record<string, any>, name: string): boolean => {

    const { user, solution } = context;

    const trackPrefix = 'hasLicense';

    if (!isNonEmptyString(name)) {
        if (_track) console.log(`${trackPrefix}.noName`);
        return false;
    }

    if (!isObject(user)) {
        if (_track) console.log(`${trackPrefix}.noUser`);
        return false;
    }

    if (isNil(solution)) {
        if (_track) console.log(`${trackPrefix}.noSolution`);
        return false;
    }

    //Get solution licenses
    let solutionLicenses = solution.licenses;

    if (!isArray(solutionLicenses)) solutionLicenses = [];

    //If there's no license for the solution, we will not check the license
    if (isArray(solutionLicenses) && solutionLicenses.length == 0) return true;

    //If user has no license for user, we will fail the user
    const userLicenses = isArray(user.licenses) ? user.licenses : [];
    if (userLicenses.length == 0) return false;

    return find(userLicenses, (userLicense) => {
        return name.toLowerCase() === userLicense.toLowerCase();
    });
};

export const checkPrivileges = (context: Record<string, any>, privileges: Array<string>, op: string, checkEntityExistFunc: any): boolean => {

    const trackPrefix = 'checkPrivileges';

    const { user } = context;

    if (!isObject(user)) {
        if (_track) console.log(`${trackPrefix}.noUser`);
        return false;
    }

    if (hasRole(context, 'SOLUTION-ADMIN')) return true;

    if (!isFunction(checkEntityExistFunc)) checkEntityExistFunc = getEntity;

    if (!isArray(privileges)) return true;
    if (privileges.length == 0) return true;

    let pass = op === 'and';
    let check = false;

    each(privileges, (privilege) => {
        const privilegeInfo = privilege.split('.');
        switch (privilegeInfo[0].toUpperCase()) {
            case 'USER':
                {
                    if (privilegeInfo[1] == 'Current' && user) check = true;
                    if (privilegeInfo[1] == 'Anonymous' && (!user || user && !user.id)) check = true;
                    pass = op === 'and' ? pass && check : pass || check;
                    break;
                }
            case 'ENTITY':
                {
                    check = (checkEntityExistFunc(context, privilegeInfo[1], privilegeInfo.length > 2 ? privilegeInfo[2] : null)) &&
                        checkEntityPrivilege(context, privilegeInfo[1],
                            privilegeInfo.length > 2 ? privilegeInfo[2] : undefined,
                            privilegeInfo.length > 3 && isNonEmptyString(privilegeInfo[3]) ? privilegeInfo[3] : 'read');
                    pass = op === 'and' ? pass && check : pass || check;
                    break;
                }
            case 'ROLE':
                {

                    check = !isNil(hasRole(context, privilegeInfo[1]));
                    pass = op === 'and' ? pass && check : pass || check;
                    break;
                }
            case 'HASLICENSE':
                {

                    check = hasLicense(context, privilegeInfo[1]);
                    pass = op === 'and' ? pass && check : pass || check;
                    break;
                }
            case 'HASNOLICENSE':
                {

                    check = !hasLicense(context, privilegeInfo[1]);
                    pass = op === 'and' ? pass && check : pass || check;
                    break;
                }
        }

        if (!check && _track) {
            console.log(`${trackPrefix}.${privilege}`, { privilegeInfo, context });
        }
    });

    if (!pass && _track) console.log(`${trackPrefix}.noPass`, { privileges });

    return pass;
};

export const checkEntityPrivilege = (context: Record<string, any>, entityName: string, entityType?: string, prType?: string): boolean => {

    if (isSolutionOwner(context)) return true;
    if (!isNonEmptyString(entityName)) return false;

    //Root Admin has all permission
    //if (isRootAdmin(context)) return true;

    const trackPrefix = 'checkEntityPrivilege';
    prType = isNonEmptyString(prType) ? prType?.toLowerCase() : 'read';

    if (!checkLicenses(context, isNonEmptyString(entityType) ? `Entity.${entityName}.${entityType}` : `Entity.${entityName}`)) {
        if (_track) console.log(`${trackPrefix}.${prType}.checkLicenses`, { entityName, entityType, prType });
        return false;
    }
    else {
        //if user has license and looking for read permission to an entity, it will be allowed by default
        if (prType === 'read') return true;
    }
    return checkPrivilege(context, entityName, entityType, undefined, prType);
};

export const checkPrivilege = (context: Record<string, any>, entityName?: string, entityType?: string, record?: Record<string, any>, prType?: string): boolean => {

    if (hasRole(context, "SOLUTION-ADMIN", record)) return true;

    let { organization, user, solution } = context;
    const trackPrefix = 'checkPrivilege';

    if (!isObject(organization)) organization = { id: context.organizationId };
    if (!isObject(user)) user = { id: context.userId };

    let result = false;

    //privilege type is required, if not being provided, it is by default read
    if (!prType) prType = 'read';
    prType = prType.toLowerCase();

    if (!record) {
        record = { id: GUID_EMPTY, entityName, entityType, organizationId: organization.id };
    }
    else {
        entityName = record.entityName;
        entityType = record.entityType;
    }

    //get the entity profile
    const entity = getEntity(solution, entityName?entityName:'', entityType);

    //entity has to be valid
    if (!isObject(entity)) {
        if (_track) console.log(`${trackPrefix}.noEntity`, { solution, entityName, entityType })
        return false;
    }

    //respect disableDelete, disableCreate or disableUpdate
    if (prType === "delete" && (record.disableDelete || entity?.disableDelete || isObject(record.system) && record.system.disableDelete)) {
        if (_track) console.log(`${trackPrefix}.disableDelete`, { record, entity, user })
        return false;
    }

    if (prType === "update" && (record.disableUpdate || entity?.disableUpdate || isObject(record.system) && record.system.disableUpdate)) {
        if (_track) console.log(`${trackPrefix}.disableUpdate`, { record, entity, user })
        return false;
    }

    if (prType === "create" && entity?.disableCreate) {
        if (_track) console.log(`${trackPrefix}.disableCreate`, { entity })
        return false;
    }

    //Rules to special user --- START

    //All in all the user has to have license to the entity
    if (!checkLicenses(context, `Entity.${entityName}`)) {

        if (_track) console.log(`${trackPrefix}.noEntityLicense`, { context, entityName });
        return false;
    }

    if (isNonEmptyString(entityType) && !checkLicenses(context, `Entity.${entityName}.${entityType}`)) {
        if (_track) console.log(`${trackPrefix}.noEntityLicense`, { context, entityType, entityName });
        return false;
    }

    //ORG-ADMIN or owner of the organization has all permissions to the records in the org
    if (hasRole(context, "ORG-ADMIN")) return true;

    //Rules to special user --- END

    //can not delete or update a record that does not exist
    if (prType === "delete" && (isEmptyGuid(record.id) || !record.id)) {
        if (_track) console.log(`${trackPrefix}.noDelete.noRecord`, { record });
        return false;
    }

    //if it is update and without record id, it may be a upsert, we will make sure there's permission to create
    if (prType === "update" && (isEmptyGuid(record.id) || !record.id)) {
        return checkPrivilege(context, entityName, entityType, record, 'create');
    }

    //Owner of the record has all permission to the record.
    if (recordOwnedByUser(user, record)) return true;


    //User don't have any permission to any record outside of the current organization
    if (record.id!=GUID_EMPTY && !recordOwnedByOrganization(user, record)) {
        if (_track) console.log(`${trackPrefix}.recordOutOfOrg`, { record, user });
        return false;
    }

    //Check privlieges defined in the roles of the user
    //Chekc whether user has permission to all privilege Types of the entity, the second all also mean to all records
    result = hasPrivilege(context, entityName + ".All.All");
    if (result) return true;

    result = hasPrivilege(context, entityName + "." + prType + ".All");
    if (result) return true;


    //Chekc whether user has permission to all privilege Types of the entity, there's no second all, it mean to all user's own record
    result = hasPrivilege(context, entityName + ".All");
    if (isEmptyGuid(record.id) && result) return true;

    //Chekc whether user has permission to the requested privilege Type of the entity
    result = hasPrivilege(context, entityName + "." + prType);
    if (isEmptyGuid(record.id) && result) return true;


    if (prType !== "create" && isEmptyGuid(record.id)) {
        if (_track) console.log(`${trackPrefix}.isEmptyGuid(record.id`, { record });
        return false;
    }

    //Start from here we check record related privilege
    switch (prType) {
        case "read":
            {
                //only reader can read the record or isGloal is true
                result = isReader(context, record.security) || record.isGlobal;

                //TODO: Now we give pass without checking Reader
                //In the future, we should use role name or depth to decision whether a user can read/update any record
                result = true;
                break;
            }
        case "changeowner":
            {
                //Some entity can not change ownership
                if (entityName == "user" || entityName == "organization") return false;

                //only owner of the record can change the record ownership
                result = sameGuid(record.ownerBy, user.id);
                break;
            }
        default:
            {
                //Author & owner can do anything to a record,
                //In the code above we have handled isOwner case
                result = isAuthor(context, record.security);
                result = true;
                break;
            }
    }

    if (!result && _track) console.log(`${trackPrefix}.final`, { entityName, entityType, record });

    return result;
};

export const isReader = (context: Record<string,any>, security: string[]): boolean => {

    const { user } = context;

    var result = find(security, (s) => s == "r." + user.id || s == "a." + user.id || s == "r." + GUID_EMPTY || s == "a." + GUID_EMPTY);
    if (result) return result?true:false;

    each(user.teamIds, (tid) => {
        if (!result) result = find(security, (s) => s == "r." + tid || s == "a." + tid);
    });

    return result?true:false;
};


export const isAuthor = (context: Record<string,any>, security: string[]): boolean => {

    const { user } = context;

    var result = find(security, (s) => s == "a." + user.id || s == "a." + GUID_EMPTY);
    if (result) return result?true:false;

    each(user.teamIds, (tid) => {
        if (!result) result = find(security, (s) => s == "a." + tid);
    });

    return result?true:false;
};

//Check whether the user has a certain privilege based the user roles
export const hasPrivilege = (context: Record<string,any>, privlege: string): boolean => {

    const { organization, user, solution } = context;

    if (!privlege) return false;
    let result = false;

    //if the user is the organization owner, it will has full permission
    if (organization && sameGuid(user.id, organization.ownedBy)) return true;

    if (!isArray(user.roles)) return false;

    //get all roles in the currentsolution
    var solutionRoles = solution.roles;

    //get all roles of the user
    var userRoles = "," + user.roles.join().toLowerCase().replace(/ /g, "") + ",";

    each(solutionRoles, (solutionRole) => {
        //check whether user has the solution role
        if (!result && userRoles.indexOf("," + solutionRole.name.toLowerCase() + ",") >= 0) {
            //get all privileges of the solution role
            var privileges = "," + solutionRole.privileges.toLowerCase().replace(/ /g, "") + ",";
            //whether the privlege is being checked included in the role that the user has
            result = privileges.indexOf("," + privlege.toLowerCase() + ",") >= 0;
        }
    });

    return result;
};


//check whether a user has a role
export const hasRole = (context: Record<string, any>, roleName: string, record?:Record<string, any>): string|undefined => {

    let { user, organization } = context;
    if (!user || isNonEmptyString(roleName)) return undefined;

    if (isSolutionOwner(context, record)) return 'SOLUTION-ADMIN';
    if (
        !isNil(record) && roleName == 'ORG-ADMIN' && sameGuid(organization.ownedBy, user.id) && sameGuid(organization.id, record.organizationId) 
        ||
        isNil(record) && roleName == 'ORG-ADMIN' && sameGuid(organization.ownedBy, user.id)
    ) return 'ORG-ADMIN';

    if (!isArray(user.roles)) return undefined;

    const role = find(user.roles, (role) => {
        return role.toLowerCase() == roleName.toLowerCase();
    });

    return role;
};