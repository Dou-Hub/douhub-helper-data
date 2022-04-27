//  Copyright PrimeObjects Software Inc. and other contributors <https://www.primeobjects.com/>
// 
//  This source code is licensed under the MIT license.
//  The detail information can be found in the LICENSE file in the root directory of this source tree.

import cheerio from 'cheerio';
import { isNumber, isNil } from 'lodash';
import { isNonEmptyString, isObject } from 'douhub-helper-util';

export const removeEmpty = (html) => {
    const emptyElementSelector = "head:empty,p:empty,span:empty,h1:empty,a:empty,h2:empty,h3:empty,h4:empty,h5:empty,h6:empty,li:empty,ol:empty,ul:empty,code:empty,i:empty,div:empty,blockquote:empty,ins:empty";
    let emptyElements = html(emptyElementSelector);
    while (emptyElements.length > 0) {
        emptyElements.remove();
        emptyElements = html(emptyElementSelector);
    }

    return html;
};

export const getBaseDomain = (domain: string): string => {
    if (isNonEmptyString(domain)) {
        const domainSegments = domain.split('.');
        const domainSegmentsCount = domainSegments.length;
        switch (domainSegmentsCount) {
            case 3:
                {
                    domain = `${domainSegments[1]}.${domainSegments[2]}`;
                    break;
                }
            case 4:
                {
                    domain = `${domainSegments[1]}.${domainSegments[2]}.${domainSegments[3]}`;
                    break;
                }
            default:
                {
                    break;
                }
        }
    }

    return domain;
}

export const cleanHTML = (content: string, settings?: Record<string, any>) => {

    if (!isNonEmptyString(content)) return null;
    settings = !isNil(settings) ? settings : {};

    const bodyOnly = settings.bodyOnly;
    const keepSingleParent = settings.keepSingleParent;
    const fromEditor = settings.fromEditor;
    const removeImage = settings.removeImage;
    const keepForm = settings.keepForm;
    const removeShortP = isNumber(settings.removeShortP) ? settings.removeShortP : false;
    const removeShortDiv = isNumber(settings.removeShortDiv) ? settings.removeShortDiv : false;
    const protocol = settings.protocol;
    const host = settings.host;
    const returnContent = settings.returnContent;

    let html = cheerio.load(content
        .replace(/&nbsp;/g, " ")
        .replace(/\r/g, " ")
        .replace(/\n/g, " ")
        .replace(/\t/g, " ")
        .replace(/!/g, '! ')
        .replace(/\?/g, '? ')
        .replace(/\./g, '. ')
        .replace(/,/g, ', ')
        .replace(/;/g, '; ')
        .replace(new RegExp(`( ){2,}`, "g"), " "));

    const body = html("html body");

    //in the case of the content is pasted from MS Word, it is a HTML page, we will need only body.
    if (bodyOnly && body) {
        let bodyHtml = body.html();
        if (isNil(bodyHtml)) bodyHtml = '';
        html = cheerio.load('<body>' +
            bodyHtml
                .replace(/<o:p>/g, "<p>")
                .replace(/<\/o:p>/g, "</p>") +
            '</body>');
    }
    html = removeComments(html);
    html('script,path,header,input,style,svg,canvas,nav,button,footer,iframe,noscript').remove();
    html = removeAllAttributes(html, 'meta,image,img,a,link,video', 'meta.property,meta.name,meta.content,img.src,img.alt,image.src,image.alt,a.href,link.href,link.rel,video.src');   // load the HTML

    html = fixImages(html, { removeImage, protocol, host });
    html = cleanElements(html, { fromEditor, keepForm, removeShortP, removeShortDiv, protocol, host });
    html = removeEmpty(html);
    if (!keepSingleParent) html = cheerio.load(removeSingleParent(html).html());

    switch (returnContent) {
        case 'html':
            {
                return html.html()
                    .replace('<html><head></head><body>', '')
                    .replace('</body></html>', '');
            }
        case 'text':
            {
                return html.text();
            }
        default:
            {
                return html;
            }
    }
};

const removeSingleParent = (html: any, parentElem?:Record<string,any>): any => {

   
    if (!parentElem) {
        parentElem = html('body');
        if (parentElem) parentElem.get(0).tagName = 'div';
    }
    const parent = parentElem?.get(0);
    if (parentElem?.children()?.length == 1) {
        const child = parentElem.children()[0];
        const childElem = html(child);

        if (parent.tagName == child.tagName && parentElem.text().trim().length == childElem.text().trim().length) {
            parentElem.html(childElem.html());
        }
    }
    parentElem?.children()?.each(
        function () {
            html(this).html(removeSingleParent(html, html(this)).html());
        });
    return parentElem;
};

export const removeComments = (html: any): any => {
    html.root()
        .contents()
        .filter(function () {
            return this.type === "comment";
        })
        .remove();

    return html;
};

export const fixImages = (html: any, settings: Record<string,any>): any => {
    let { protocol, host, removeImage } = settings;
    if (!isNonEmptyString(host)) return html;
    protocol = isNonEmptyString(protocol) ? protocol : "https";

    if (removeImage) {
        html("img").remove();
    }
    else {
        html("img").each(function () {
            if (isNonEmptyString(this.attribs.src)) {
                const src = html(this).attr("src");
                if (src.indexOf('//') == 0) {
                    html(this).attr("src", `${protocol}:${src}`);
                }
                if (src.indexOf('/') == 0) {
                    html(this).attr("src", `${protocol}://${host}${src}`);
                }
            }
            else {
                html(this).remove();
            }
        });
    }

    return html;
};

export const cleanElements = (html, settings: Record<string,any>) => {
    const { fromEditor, protocol, host, keepForm, removeShortP, removeShortDiv } = settings;
    let removed = false;
    html("*").each(function () {
        html(this)
            .contents()
            .filter(function () {
                return this.type === "comment";
            })
            .remove();

        const tagName = html(this).get(0).tagName.toLowerCase();
        switch (tagName) {
            case "form": {
                if (!keepForm) {
                    html(this).remove();
                    removed = true;
                }
                break;
            }
            case "script": {
                html(this).remove();
                removed = true;
                break;
            }
            case "img": {

                if (!isNonEmptyString(this.attribs.src)) {
                    html(this).remove();
                    removed = true;
                }
                else {
                    //image must have alt
                    if (!isNonEmptyString(this.attribs.alt)) {
                        this.attribs.alt = this.attribs.src;
                    }

                    //image elements paraent has to be div or body
                    let parent = html(this).parent();
                    while (parent && parent.get(0) && (parent.get(0).tagName != 'div' && parent.get(0).tagName != 'body')) {
                        parent.get(0).tagName = 'div';
                        parent = parent.parent();
                    }
                }
                break;
            }
            case "a":
                {
                    if (!isNonEmptyString(this.attribs.href)) {
                        html(this).remove();
                        removed = true;
                    }
                    else {
                        const href = html(this).attr("href");
                        if (href.indexOf('//') == 0) {
                            html(this).attr("href", `${protocol}:${href}`);
                        }
                        if (href.indexOf('/') == 0) {
                            html(this).attr("href", `${protocol}://${host}${href}`);
                        }
                    }

                    if (html(this).children().length == 0 && html(this).text().length == 0) {
                        html(this).remove();
                        removed = true;
                    }

                    if (!removed) {

                        this.attribs.target = "_blank";

                        if (fromEditor && html(this).children().length == 1 && html(this).children()[0].name == 'img') {
                            html(this).get(0).tagName = 'img';
                            this.attribs.src = html(this).children()[0].attribs.src;
                            html(this).html('');
                        }
                        else {
                            //a can only be the parent of text
                            html(this).html(html(this).text());
                        }
                    }

                    break;
                }
            case "video":
                {
                    if (!isNonEmptyString(this.attribs.src)) {
                        html(this).remove();
                        removed = true;
                    }
                    else {
                        if (!fromEditor) {
                            html(this).get(0).tagName = 'div';
                            this.attribs.class = "form-field-html-video-container";
                            html(this).html(`<iframe class="form-field-html-video" src="${this.attribs.src}"/>`);
                        }
                    }
                    break;
                }
            case "iframe": {
                if (!isNonEmptyString(this.attribs.src)) {
                    html(this).remove();
                    removed = true;
                }
                break;
            }
            case "time":
            case "em":
            case "u":
                {
                    html(this).get(0).tagName = "span";
                    if (html(this).text().trim().length == 0 && html(this).children().length == 0) {
                        html(this).remove();
                        removed = true;
                    }
                    break;
                }
            case "i":
            case "strong":
            case "small":
            case "b":
            case "sup":
            case "sub":
                {
                    if (html(this).text().length == 0 && html(this).children().length == 0) {
                        html(this).remove();
                        removed = true;
                    }
                    else {
                        //these element does not allow to have sub element in html editor, we will change them to span
                        if (html(this).children().length > 0) {
                            html(this).get(0).tagName = "span";
                        }
                    }
                    break;
                }
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
            case "blockquote":
            case "code":
            case "ins":
            case "span":
            case "title":
            case "ul":
            case "ol":
            case "li":
                {
                    if (html(this).text().trim().length == 0 && html(this).children().length == 0) {
                        html(this).remove();
                        removed = true;
                    }
                    else {
                        if (tagName == 'h5' || tagName == 'h6') {
                            html(this).get(0).tagName = "p";
                        }
                    }
                    break;
                }
            case "hr":
                {
                    html(this).remove();
                    removed = true;
                    break;
                }
            case "head":
            case "meta":
            case "body":
            case "html":
            case "br":
            case "link":
                {
                    break;
                }
            case "p":
                {
                    if (html(this).text().trim().length == 0 && html(this).children().length == 0 || removeShortP && html(this).text().trim().length < removeShortP) {
                        html(this).remove();
                        removed = true;
                    }
                    break;
                }
            case "div":
                {
                    if (html(this).text().trim().length == 0 && html(this).children().length == 0 || removeShortDiv && html(this).text().trim().length < removeShortDiv) {
                        html(this).remove();
                        removed = true;
                    }
                    //do nothing
                    break;
                }
            case "section":
            case "article":
                {
                    html(this).get(0).tagName = "div";
                    break;
                }
            default: {
                html(this).get(0).tagName = "p";
                if (html(this).text().length == 0 && html(this).children().length == 0) {
                    html(this).remove();
                    removed = true;
                }
                break;
            }
        }
    });

    if (removed) html = cleanElements(html, settings);

    return html;
};

export const removeAllAttributes = (html, exceptTags:string, exceptAttrs:string) => {
 
    exceptTags = isNonEmptyString(exceptTags)
        ? `,${exceptTags},`.toLowerCase()
        : '';
    exceptAttrs = isNonEmptyString(exceptAttrs)
        ? `,${exceptAttrs},`.toLowerCase()
        : '';

        html("*").each(function () {
        // iterate over all elements

        const tagName = html(this).get(0).tagName;
        if (exceptTags.indexOf(`,${tagName.toLowerCase()},`) < 0) {
            this.attribs = {}; // remove all attributes
        } else {
            if (exceptAttrs.indexOf(`,${tagName}.`) >= 0) {
                const newAttribs = {};
                for (let key in this.attribs) {
                    if (exceptAttrs.indexOf(`,${tagName}.${key},`) >= 0) {
                        newAttribs[key] = this.attribs[key];
                    }
                }
                this.attribs = newAttribs;
            }
        }
    });

    return html;
};