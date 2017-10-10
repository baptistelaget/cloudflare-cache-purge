'use strict';
global.Promise = require('bluebird');

const [, , domain, purgefile] = process.argv;

if (!(domain && purgefile)) {
    throw Error('Missing arguments');
}

require('dotenv').load();
const {CF_ROOT, CF_EMAIL, CF_API_KEY, SCHEME} = process.env;
if (!(CF_EMAIL && CF_API_KEY)) {
    throw Error('Missing credentials');
}
const cfHeaders = {
    'X-Auth-Email': CF_EMAIL,
    'X-Auth-Key': CF_API_KEY
};

const fs = require('fs')
    , path = require('path')
    , url = require('url')
    , request = require('request-promise');

function findZoneForDomain() {
    const {hostname} = getDomainURL();

    const tldIdx = hostname.lastIndexOf('.')
        , domainIdx = hostname.lastIndexOf('.', tldIdx - 1) + 1
        , rootDomain = hostname.slice(domainIdx);

    return request.get({
                           url: `${CF_ROOT}/zones`,
                           qs: {name: rootDomain},
                           headers: cfHeaders,
                           json: true
                       })
                  .then(({result = []}) => {
                      if (result.length < 1) {
                          return Promise.reject(Error('Zone not found'));
                      } else {
                          const [{id}] = result;
                          return id;
                      }
                  });
}

/**
 * @returns {Promise<string[]>}
 */
function loadFiles() {
    const purgeFileContent = fs.readFileSync(path.resolve(purgefile));

    try {
        const filesToPurge = JSON.parse(purgeFileContent);

        if (Array.isArray(filesToPurge) && filesToPurge.every(e => typeof e === 'string')) {
            return filesToPurge.length > 30
                ? Promise.reject(Error('Too many (>30) files to purge.'))
                : Promise.resolve(filesToPurge);
        } else {
            return Promise.reject(Error('Purgefile is not a valid JSON array of strings.'));
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

/**
 * @returns {Url}
 */
function getDomainURL() {
    return url.parse(
        /^https?:\/\/.+/.test(domain)
            ? domain
            : `${SCHEME}://${domain}`
    );
}

function getDomainResolvedFiles() {
    const domainUrlStr = url.format(getDomainURL());

    return loadFiles().then(files => files.map(file => url.resolve(domainUrlStr, file)));
}

function purgeFilesInZone(zoneId, files) {
    return request.delete({
                              url: `${CF_ROOT}/zones/${zoneId}/purge_cache`,
                              body: {files},
                              headers: cfHeaders,
                              json: true
                          });
}

function purgeDomain() {
    return Promise.join(findZoneForDomain(), getDomainResolvedFiles(), purgeFilesInZone)
                  .then(purgeResponse => console.log(purgeResponse));
}

purgeDomain();
