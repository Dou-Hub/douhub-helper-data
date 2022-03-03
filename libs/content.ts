import {
    isObject, isNonEmptyString, getRecordFullName, getRecordMedia,
    getRecordDisplay, getRecordAbstract,
    readableFileSize, numberWithCommas, getIntValueOfObject, getPropValueOfObject
} from 'douhub-helper-util';
import { isArray, each, isBoolean, isNumber, find, repeat, isString, isUndefined, isNull, isFunction, isNil } from 'lodash';
import { cleanHTML } from './data-web';
import * as moment from 'moment';
import readTime from 'read-time-estimate';
import { marked } from 'marked';

export const markdownToHTML = (content: string): string => {
    return marked(content);
};

export const getReadTime = (
    content,
    customWordTime,
    customImageTime,
    chineseKoreanReadTime,
    imageTags
) => {
    if (!isNonEmptyString(content)) content = "";
    return readTime(
        content,
        customWordTime,
        customImageTime,
        chineseKoreanReadTime,
        imageTags
    );
};

export const getPropValueOfContext = (context: Record<string, any>, propName: string, defaltValue?: any) => {
    const user = isObject(context.user) ? context.user : {};
    if (!isNil(user[propName])) return user[propName];
    const organization = isObject(context.organization) ? context.organization : {};
    if (!isNil(organization[propName])) return organization[propName];
    return defaltValue;
}

export const getDateFormat = (context: Record<string, any>, defaltValue?: string): string => {
    if (!isNonEmptyString(defaltValue)) defaltValue = 'YYYY-MM-DD';
    return getPropValueOfContext(context, 'dateFormat', defaltValue);
};

export const getTimeFormat = (context: Record<string, any>, defaltValue?: string): string => {
    if (!isNonEmptyString(defaltValue)) defaltValue = 'HH:mm';
    return getPropValueOfContext(context, 'timeFormat', defaltValue);
};

export const getDateTimeFormat = (context: Record<string, any>, defaltValue?: string): string => {
    if (!isNonEmptyString(defaltValue)) defaltValue = 'YYYY-MM-DD HH:mm';
    return getPropValueOfContext(context, 'dateTimeFormat', defaltValue);
};


export const getTimeZoneOffset = (context: Record<string, any>, defaltValue?: number): number => {
    if (!isNonEmptyString(defaltValue)) defaltValue = (new Date()).getTimezoneOffset();
    const result = getPropValueOfContext(context, 'timeZoneOffset', defaltValue);
    return isNumber(result) ? result : 0;
};


export const formatDate = (context: Record<string, any>, dt, format?: string): string => {
    return dt && moment(dt).isValid() ? moment(dt).utcOffset(-getTimeZoneOffset(context), false).format(isNonEmptyString(format) ? format : getDateFormat(context)) : '';
};

export const formatTime = (context: Record<string, any>, dt, format?: string): string => {
    return dt && moment(dt).isValid() ? moment(dt).utcOffset(-getTimeZoneOffset(context), false).format(isNonEmptyString(format) ? format : getTimeFormat(context)) : '';
};

export const formatDateTime = (context: Record<string, any>, dt, format?: string): string => {
    return dt && moment(dt).isValid() ? moment(dt).utcOffset(-getTimeZoneOffset(context), false).format(isNonEmptyString(format) ? format : getDateTimeFormat(context)) : '';
};

export const processSearchResult = (content, record) => {

    let result = '';

    if (isObject(record.highlight)) {

        let searchDisplay = record.highlight.searchDisplay;
        let searchContent = record.highlight.searchContent;

        if (!isArray(searchDisplay)) searchDisplay = [];
        if (!isArray(searchContent)) searchContent = [];

        //we will have min 3 result lines
        let resultCount = 0;
        each(searchDisplay, (r) => {
            if (r.trim().length > 0) {
                resultCount++;
                if (resultCount <= 3) result = `${result}${r} ... `;
            }
        });

        each(searchContent, (r) => {
            if (r.trim().length > 0) {
                resultCount++;
                if (resultCount <= 3) result = `${result}${r} ... `;
            }
        });
    }

    content = content.replace(/\[PH[.]SEARCHRESULT\]/g, result);
    content = content.replace(/\[PH[.]SEARCHRESULT.LEN\]/g, result.trim().length);
    content = content.replace(/\[PH[.]SEARCHRESULT.HAS_VALUE\]/g, result.trim().length > 0 ? 'true' : 'false');

    return content;
};

export const processContent = async (
    context: Record<string, any>,
    init: boolean,
    content: string,
    r,
    prefix?: string,
    settings?: {
        hasMedia?: boolean,
        hasMarkdown?: boolean,
        hasQueryEncode?: boolean,
        hasReadtime?: boolean,
        hasArrayContain?: boolean,
        keepUnhandedPlaceholder?: boolean,
        props?: string,
        hasHTML?: boolean,
        onInit?: (content: string) => string
    }): Promise<string> => {

    const user = isObject(context.user) ? context.user : { id: context.userId };

    if (!isObject(settings)) settings = {};
    if (!isNonEmptyString(content)) return '';
    if (!isNonEmptyString(prefix)) prefix = 'PH';

    if (init && settings) {
        settings.hasMarkdown = content.indexOf(`.MARKDOWN]`) > 0;
        settings.hasQueryEncode = content.indexOf(`.QUERYENCODE]`) > 0;
        settings.hasReadtime = content.indexOf(`.READTIME]`) > 0;
        settings.hasArrayContain = content.indexOf(`.CONTAIN(`) > 0;
        settings.hasMedia = content.indexOf(`.MEDIA]`) > 0;
        settings.hasHTML = content.indexOf(`.HTML]`) >= 0
    }

    //if there's no placeholder match the prefix, no need to continue
    if (!(new RegExp(`\\[${prefix}[.]`)).test(content)) return content;
    if (prefix?.toLowerCase() == 'secret') return content;

    if (init) {
        content = content.replace(/\[PH[.]NEWLINE\]/g, '\n');
        if (r['_ts']) content = content.replace(/\[PH[.]TS\]/g, r['_ts']);

        content = content.replace(/\[PH[.]IS_ANONYMOUS\]/g, user && user.id ? 'false' : 'true');
        content = content.replace(/\[PH[.]IS_NOT_ANONYMOUS\]/g, user && user.id ? 'true' : 'false');

        content = processSearchResult(content, r);
    }


    //replace some special placeholders
    //handle fullName
    const rFullName: any = getRecordFullName(r);
    content = content.replace(new RegExp(`\\[${prefix}[.]FULLNAME\\]`, "g"), rFullName);
    content = content.replace(new RegExp(`\\[${prefix}[.]FULLNAME.LEN\\]`, "g"), rFullName.trim().length);
    content = content.replace(new RegExp(`\\[${prefix}[.]FULLNAME.HAS_VALUE\\]`, "g"), rFullName.trim().length > 0 ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]FULLNAME.HAS_NO_VALUE\\]`, "g"), rFullName.trim().length == 0 ? 'true' : 'false');

    if (settings && settings.hasMedia) {

        const rMedia: any = getRecordMedia(r);
        content = content.replace(new RegExp(`\\[${prefix}[.]MEDIA\\]`, "g"), rMedia);
        content = content.replace(new RegExp(`\\[${prefix}[.]MEDIA.LEN\\]`, "g"), rMedia.trim().length);
        content = content.replace(new RegExp(`\\[${prefix}[.]MEDIA.HAS_VALUE\\]`, "g"), rMedia.trim().length > 0 ? 'true' : 'false');
        content = content.replace(new RegExp(`\\[${prefix}[.]MEDIA.HAS_NO_VALUE\\]`, "g"), rMedia.trim().length == 0 ? 'true' : 'false');

    }

    //handle fullName
    const rDisplay: any = getRecordDisplay(r);
    content = content.replace(new RegExp(`\\[${prefix}[.]DISPLAY\\]`, "g"), rDisplay);
    content = content.replace(new RegExp(`\\[${prefix}[.]DISPLAY.LEN\\]`, "g"), rDisplay.trim().length);
    content = content.replace(new RegExp(`\\[${prefix}[.]DISPLAY.HAS_VALUE\\]`, "g"), rDisplay.trim().length > 0 ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]DISPLAY.HAS_NO_VALUE\\]`, "g"), rDisplay.trim().length == 0 ? 'true' : 'false');

    const isOwnedByMe = user && r.ownedBy == user.id ? 'true' : 'false';
    content = content.replace(new RegExp(`\\[${prefix}[.]IS_OWNED_BY_CURRENT_USER\\]`, "g"), isOwnedByMe == 'true' ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]IS_NOT_OWNED_BY_CURRENT_USER\\]`, "g"), isOwnedByMe == 'false' ? 'true' : 'false');

    const isOwnedByOrg = user && user.organizationId && r.organizationId == user.organizationId ? 'true' : 'false';
    content = content.replace(new RegExp(`\\[${prefix}[.]IS_OWNED_BY_CURRENT_ORGANIZATION\\]`, "g"), isOwnedByOrg == 'true' ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]IS_NOT_OWNED_BY_CURRENT_ORGANIZATION\\]`, "g"), isOwnedByOrg == 'false' ? 'true' : 'false');


    const rAbstract: any = getRecordAbstract(r);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT\\]`, "g"), rAbstract);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.32\\]`, "g"), rAbstract.length <= 32 ? rAbstract : `${rAbstract.substring(0, 32)} ...`);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.64\\]`, "g"), rAbstract.length <= 64 ? rAbstract : `${rAbstract.substring(0, 64)} ...`);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.128\\]`, "g"), rAbstract.length <= 128 ? rAbstract : `${rAbstract.substring(0, 128)} ...`);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.256\\]`, "g"), rAbstract.length <= 256 ? rAbstract : `${rAbstract.substring(0, 256)} ...`);

    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.LEN\\]`, "g"), rAbstract.trim().length);
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.HAS_VALUE\\]`, "g"), rAbstract.trim().length > 0 ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.HAS_NO_VALUE\\]`, "g"), rAbstract.trim().length == 0 ? 'true' : 'false');
    content = content.replace(new RegExp(`\\[${prefix}[.]ABSTRACT.QUERYENCODE\\]`, "g"), encodeURIComponent(rAbstract.trim()));

    content = content.replace(new RegExp(`\\[${prefix}[.]ID\\]`, "g"), isNonEmptyString(r.id) ? r.id : '');
    content = content.replace(new RegExp(`\\[${prefix}[.]KEY\\]`, "g"), isNonEmptyString(r.key) || isNumber(r.key) ? `${r.key}` : '');


    for (var prop in r) {

        let v: any = r[prop];
        let arrayValues: string[] = [];

        if (v == null || v == undefined) {
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_NO_VALUE\\]`, "g"), 'true');
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]FALSE\\]`, "g"), 'true');
            v = '';
        }

        if (isBoolean(v)) v = `${v}`.toLowerCase();
        if (isArray(v)) {
            arrayValues = v.slice(0);
            v = v.join(', ');
        }

        if (isObject(v) || isArray(v)) {
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_VALUE\\]`, "g"), v ? 'true' : 'false');
        }

        if (!isObject(v) && content.indexOf(`[${prefix}.`) >= 0) {

            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_VALUE\\]`, "g"), v && `${v}`.trim().length > 0 ? 'true' : 'false');
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_NO_VALUE\\]`, "g"), v && `${v}`.trim().length == 0 ? 'true' : 'false');

            const isCurrentUser = isNonEmptyString(v) && isObject(user) && v == user.id ? 'true' : 'false';
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]IS_CURRENT_USER\\]`, "g"), isCurrentUser == 'true' ? 'true' : 'false');
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]IS_NOT_CURRENT_USER\\]`, "g"), isCurrentUser == 'false' ? 'true' : 'false');

            const isCurrentOrg = isNonEmptyString(v) && isObject(user) && v == user.organizationId ? 'true' : 'false';
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]IS_CURRENT_ORGANIZATION\\]`, "g"), isCurrentOrg == 'true' ? 'true' : 'false');
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]IS_NOT_CURRENT_ORGANIZATION\\]`, "g"), isCurrentOrg == 'false' ? 'true' : 'false');

            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]TRUE\\]`, "g"), v == 'true' ? 'true' : 'false');
            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]FALSE\\]`, "g"), (v == 'false' || v == '') ? 'true' : 'false');

            if (settings?.hasHTML) {
                const htmlV: any = isNonEmptyString(v) ? cleanHTML(v, { removeHTMLBODY: true, returnContent: 'html' }) : '';
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HTML\\]`, "g"), htmlV);
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HTML.HAS_VALUE\\]`, "g"), isNonEmptyString(htmlV) ? 'true' : 'false');
            }

            if (isNumber(v)) {
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]FS\\]`, "g"), readableFileSize(v));
                const nwC = numberWithCommas(v);
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]C\\]`, "g"), nwC ? nwC : '');
            }
            else {
                if (moment(v, moment.ISO_8601).isValid()) {
                    content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]DT\\]`, "g"), formatDateTime(context, v));
                    content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]D\\]`, "g"), formatDate(context, v));
                    content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]T\\]`, "g"), formatTime(context, v));
                }
            }

            if (arrayValues && settings && settings.hasArrayContain) {
                const arrayRegex = `\\[${prefix}[.]${prop.toUpperCase()}[.]CONTAIN[(](.)+[)]\\]`;
                const arrayRegExp = new RegExp(arrayRegex, "g");
                const contentHasMatches = content.match(arrayRegExp);

                if (isArray(contentHasMatches) && contentHasMatches.length > 0) {
                    each(contentHasMatches, (contentHasMatch) => {
                        const arrayValueToCheck = contentHasMatch.split('(')[1].replace(')]', '');
                        if (find(arrayValues, (arrayValue) => arrayValue == arrayValueToCheck)) {
                            content = content.replace(new RegExp(arrayRegex.replace('(.)+', arrayValueToCheck), "g"), 'true');
                        }
                        else {
                            content = content.replace(new RegExp(arrayRegex.replace('(.)+', arrayValueToCheck), "g"), 'false');
                        }
                    });
                }
            }

            if (settings?.hasReadtime && isString(v)) {

                const readtimeAdjust: number = isNumber(r.readtimeAdjust) ? parseInt(r.readtimeAdjust) : 0; //seconds

                if (readtimeAdjust > 0) {
                    //we will have to give some fake addtional content so readTime will count more based on 275 words/mins
                    //roughly 4.5 words / second
                    v = v + repeat(' word', parseInt(`${4.5 * readtimeAdjust + 0.5}`));
                }

                let { duration, humanizedDuration } = readTime(v);

                if (duration < 0.6) {
                    duration = parseInt(`${(duration + 0.05) * 10}`) == 0 ? '' : parseInt(`${(duration + 0.05) * 10}`) * 10 + ' seconds';
                }
                else {
                    duration = humanizedDuration;
                }

                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]READTIME\\]`, "g"), isNonEmptyString(duration) ? duration : 'a few seconds');
            }


            if (settings?.hasMarkdown) {
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]MARKDOWN\\]`, "g"), isString(v) ? markdownToHTML(v) : '');
            }

            if (settings?.hasQueryEncode) {
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]QUERYENCODE\\]`, "g"), isString(v) ? encodeURIComponent(v) : '');
            }


            content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}\\]`, "g"), v);
        }

        content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]LEN\\]`, "g"), isArray(v) && v.length > 0 && v[0].trim().length > 0 || isString(v) ? `${v.length}` : '0');

        if (isNonEmptyString(v) && v.length > 256) content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}.256\\]`, "g"), `${v.substring(0, 256)} ...`);
        if (isNonEmptyString(v) && v.length > 128) content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}.128\\]`, "g"), `${v.substring(0, 128)} ...`);
        if (isNonEmptyString(v) && v.length > 64) content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}.64\\]`, "g"), `${v.substring(0, 64)} ...`);
        if (isNonEmptyString(v) && v.length > 32) content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}.32\\]`, "g"), `${v.substring(0, 32)} ...`);

        if (isObject(v) &&
            !(prefix?.toLowerCase() == 'solution' && prop.toLowerCase() == 'entities') &&
            content.indexOf(`[${prefix}.${prop.toUpperCase()}.`) >= 0
        ) {
            //console.log({ v: v.name, prefix: `${prefix}.${prop.toUpperCase()}` });
            content = await processContent(context, false, content, v, `${prefix}.${prop.toUpperCase()}`, settings);
        }

    }
    if (init) {
        content = content.replace(/\[PH[.](\w+)[.](\w+)[.]HAS_VALUE\]/g, 'false');
        content = content.replace(/\[PH[.](\w+)[.]HAS_NO_VALUE\]/g, 'true');
        content = content.replace(/\[PH[.](\w+)[.]FALSE\]/g, 'true');
        content = content.replace(/\[PH[.](\w+)[.]TRUE\]/g, 'false');

        if (!settings?.keepUnhandedPlaceholder) {
            content = content.replace(/\[PH[.](\w+)[.](\w+)\]/g, '');
            content = content.replace(/\[PH[.](\w+)\]/g, '');
        }

        //Handle those null value if there's props defined;
        if (isNonEmptyString(settings?.props) && isObject(r)) {
            const propList = settings?.props?.split(',');
            each(propList, (prop) => {
                //console.log({prop, v:r[prop], c})

                if (!isNull(r[prop]) && !isUndefined(r[prop])) return;

                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}\\]`, "g"), '');
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.](\\w+)\\]`, "g"), '');
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_VALUE\\]`, "g"), 'false');
                content = content.replace(new RegExp(`\\[${prefix}[.]${prop.toUpperCase()}[.]HAS_NO_VALUE\\]`, "g"), 'true');

            });
        }

        if (settings && isFunction(settings?.onInit)) content = settings?.onInit(content);

        return content;
    }
    else {
        content = content.replace(new RegExp(`\\[${prefix}[.](\\w+)[.]HAS_VALUE\\]`, "g"), 'false');
        content = content.replace(new RegExp(`\\[${prefix}[.](\\w+)[.]HAS_NO_VALUE\\]`, "g"), 'true');
        content = content.replace(new RegExp(`\\[${prefix}[.](\\w+)[.]FALSE\\]`, "g"), 'true');
        content = content.replace(new RegExp(`\\[${prefix}[.](\\w+)[.]TRUE\\]`, "g"), 'false');
    }

    return content;
};
