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
import { solution } from '../../shared/metadata/solution';

export const processResult = (context, data) => {

    //Need at least one record
    if (data.length == 0) return data;

    data = _.map(data, (r) => {
        const c = processAttributeValueText(context, r);
        context = c.context;
        return c.r;
    });

    return data;
};

//The function will generate helper props in solution object
//It helps to display the text for a certain attribute value
//For example, the record.stateCode can be 0, but we want know the picklist text for value/code 0
//Althought for example the picklist field of a form has definition of all options (it has value and text)
//In order to provide broader value<->text relationship, we rely on the entity.attributeValueTexts
//Please check the SolutionDefinition entity profile as a example 
export const processAttributeValueTextSettings = (context, entityName, entityType) => {

    const key = `attributeValueText_${entityName}_${entityType}`;
    if (!_.isObject(solution) || solution[key]) return context;

    //prepross the attributeValueTexts settings in the entity profile 
    const entity = _.find(solution.entities, (entity) => {
        if (entity.entityName === entityName) {
            return !entityType ? true : entity.entityType === entityType;
        }
        return false;
    });

    if (_.trackLibs) console.log(entity);

    if (_.isObject(entity) && _.isArray(entity.attributeValueTexts)) {
        if (_.trackLibs) console.log(entity.attributeValueTexts);

        const attributeValueTexts = {};
        _.each(entity.attributeValueTexts, (attr) => {
            attributeValueTexts[attr.name] = {};
            _.each(attr.values, (v) => {
                //in case the metadata uses id
                if (v.value == undefined && v.id != undefined) v.value = v.id;
                attributeValueTexts[attr.name][v.value] = _.localize(solution.localization, v.text); //localize
            });
        });

        solution[key] = attributeValueTexts;
    }
    else {
        solution[key] = {};
    }

    if (_.trackLibs) console.log(key, solution[key]);

    return context;
};

export const processAttributeValueText = (context, r) => {
    
    //console.log('processAttributeValueText-processAttributeValueTextSettings');

    context = processAttributeValueTextSettings(context, r.entityName, r.entityType);

    const attributeValueTexts = solution[`attributeValueText_${r.entityName}_${r.entityType}`];

    //console.log('processAttributeValueText-attributeValueTexts', attributeValueTexts);

    _.forOwn(r, function (value, key) {
        const prop = attributeValueTexts[key];
        if (prop) {
            const text = attributeValueTexts[key][value];
            if (text) {
                r[`${key}_Text`] = text;
            }
        }

    });

    return { r, context };

};
