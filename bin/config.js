'use strict';

let path = require('path');

const _ = require('lodash');

let setConfigDefaults = config => {
    if (config.snappit.cicd === undefined) {
        config.snappit.cicd = {};
    }

    config.snappit.cicd = _.defaults(config.snappit.cicd, {
        githubTokenEnvironmentVariable: 'ghToken',
        targetBranch: 'master'
    });

    if (config.snappit.cicd.messages === undefined) {
        config.snappit.cicd.messages = {};
    }

    config.snappit.cicd.messages = _.defaults(config.snappit.cicd.messages, {
        branchName: function (vars) {
            return `SHA-${vars.sha1}`;
        },

        commitMessage: function (vars) {
            return `chore(screenshots): For ${vars.repoSlug}@${vars.sha1}`;
        },

        pullRequestBody: function (vars) {
            if (vars.pullRequestNumber) {
                return `See ${vars.repoSlug}#${vars.pullRequestNumber}.`
            }
            return `See ${vars.repoSlug}@${vars.sha1}. Pull request number unknown.`;
        },

        pullRequestTitle: function (vars) {
            if (vars.pullRequestNumber) {
                return `Screenshots for ${vars.repoSlug}#${vars.pullRequestNumber}`
            }
            return `Screenshots for ${vars.repoSlug}@${vars.sha1}`;
        }
    });

    return config;
};

exports.fromProtractorConf = protractorConfPath => {
    let config = require(path.join(process.cwd(), protractorConfPath)).config;
    return setConfigDefaults(config);
};
