//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import { ORGANIZATION } from './libs/data/profiles/organization';
import { USER} from './libs/data/profiles/user';
import { TAGS_BASE} from './libs/data/tags/tags-base';
import { TAGS_COLORS} from './libs/data/tags/tags-colors';
import { TAGS_NAMES} from './libs/data/tags/tags-names';

export {
    hasRole,
    checkRecordPrivilege,
    isSolutionOwner,
    recordOwnedByUser,
    recordOwnedByOrganization,
    checkLicenses,
    hasLicense,
    checkPrivileges,
    checkEntityPrivilege,
    checkPrivilege,
    isReader,
    isAuthor,
    hasPrivilege
} from './libs/data-auth';

export {
    DEFAULT_LOOKUP_ATTRIBUTES,
    processQuery,
    groupConditions,
    handleCategoryConditions,
    handleCategoryConditionsBase,
    handleTagConditions,
    handleSecurityConditions,
    handleSecurityCondition_Scope,
    handleSolutionConditions,
    handleScopeCondition,
    handleIdCondition,
    handleIdsCondition,
    handleSlugCondition,
    handleAttributes,
    handleOrderBy
} from './libs/data-query-processor';


export {
    processResult,
    processAttributeValueTextSettings,
    processAttributeValueText
} from './libs/data-result-processor';

export {
    createUser,
    getUserOrgs,
    verifyUserCode,
} from './libs/user';

export {
    checkDuplication, retrieveRecord, 
    query, retrieveRelatedRecords, createRecord, 
    deleteRecord, upsertRecord, partialUpdateRecord, 
    updateRecord, processUpsertData
} from './libs/data';

export {
    ORGANIZATION,
    USER,
    TAGS_BASE,
    TAGS_COLORS,
    TAGS_NAMES
}