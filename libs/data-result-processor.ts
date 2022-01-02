//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import { map, isArray, each, find, forOwn} from 'lodash';
import { isObject, _track } from 'douhub-helper-util';

export const processResult = (context:Record<string,any>, data:Array<Record<string,any>>):Array<Record<string,any>> => {

    //Need at least one record
    if (data.length == 0) return data;

    data = map(data, (record) => {
        const c = processAttributeValueText(context, record);
        context = c.context;
        return c.record;
    });

    return data;
};

//The function will generate helper props in solution object
//It helps to display the text for a certain attribute value
//For example, the record.stateCode can be 0, but we want know the picklist text for value/code 0
//Althought for example the picklist field of a form has definition of all options (it has value and text)
//In order to provide broader value<->text relationship, we rely on the entity.attributeValueTexts
//Please check the SolutionDefinition entity profile as a example 
export const processAttributeValueTextSettings = (context:Record<string,any>, entityName: string, entityType?:string):Record<string,any> => {

    const {solution} = context;

    const key = `attributeValueText_${entityName}_${entityType}`;
    if (!isObject(solution) || solution[key]) return context;

    //prepross the attributeValueTexts settings in the entity profile 
    const entity = find(solution.entities, (entity) => {
        if (entity.entityName === entityName) {
            return !entityType ? true : entity.entityType === entityType;
        }
        return false;
    });

    if (_track) console.log(entity);

    if (isObject(entity) && isArray(entity.attributeValueTexts)) {
        if (_track) console.log(entity.attributeValueTexts);

        const attributeValueTexts:Record<string,any> = {};
        each(entity.attributeValueTexts, (attr) => {
            attributeValueTexts[attr.name] = {};
            each(attr.values, (v) => {
                //in case the metadata uses id
                if (v.value == undefined && v.id != undefined) v.value = v.id;
                attributeValueTexts[attr.name][v.value] = v.text; 
            });
        });

        solution[key] = attributeValueTexts;
    }
    else {
        solution[key] = {};
    }

    if (_track) console.log(key, solution[key]);

    return context;
};

export const processAttributeValueText = (context:Record<string,any>, record:Record<string,any>):Record<string,any> => {

    //console.log('processAttributeValueText-processAttributeValueTextSettings');

    const {solution} = context;

    context = processAttributeValueTextSettings(context, record.entityName, record.entityType);

    const attributeValueTexts = solution[`attributeValueText_${record.entityName}_${record.entityType}`];

    //console.log('processAttributeValueText-attributeValueTexts', attributeValueTexts);

    forOwn(record,  (value, key) => {
        const prop = attributeValueTexts[key];
        if (prop) {
            const text = attributeValueTexts[key][value];
            if (text) {
                record[`${key}_Text`] = text;
            }
        }

    });

    return { record, context };

};
