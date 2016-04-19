#!/usr/bin/env node

'use strict';

let execSync = require('child_process').execSync;
let https = require('https');
let path = require('path');
let url = require('url');

var _ = require('lodash');

let args = process.argv.slice(2);
let action = args[1];

let actions = {
    clone: 'Clone the repository',
    commit: 'Commit screenshots',
    push: 'Push up visual changes to github',
    pr: 'Create a pull request'
};

let longestAction =_.maxBy(_.keys(actions), 'length');
let helpText = `
Usage: snappit-ci configFile [${_.keys(actions).join('|')}]

Actions:
`;
if (action === undefined || !_.includes(actions, action)) {
    console.log(helpText);
    _.each(actions, (details, a) => { console.log(_.padEnd(a, longestAction.length), details) });
    process.exit(0);
}

let config = require(path.join(process.cwd(), args[0])).config;
let projectRepo = url.parse(config.snappit.cicd.projectRepo);
let screenshotsRepo = url.parse(config.snappit.cicd.screenshotsRepo);

let token = process.env[config.snappit.cicd.githubEnvironmentVariable];
let currentBranch = execSync('git branch --no-color | grep "^*\s" | cut -c3-').toString('utf-8');

/**
 * Codeship doesn't natively support getting you the branch number of a pull request
 * because they build as soon as a commit is pushed, not when a PR is opened. So,
 * this searches for any pull requests that match the current branch. If no pull request
 * is open, then a warning text is returned instead.
 */
let findPullRequestNumber = (branchName) => {
    var options = {
        hostname: `api.${projectRepo.hostname}`,
        path: `/repos${projectRepo.path}/pulls?head=${orgName}:${branchName}`,
        method: 'GET',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, function (res) {
            var response = [];
            res.on('data', d => {
                response.push(d.toString('utf-8'));
            });

            res.on('end', () => {
                let pullRequests = JSON.parse(response.join(''));
                if (pullRequests.length) {
                    return resolve(pullRequests[0].number);
                }

                return reject('No pull request has been created against this branch yet');
            });
        });

        req.end();

    });

};

/**
 * Supported CI Environments. All this means is that there's some "convenience" vars available
 * to users to construct custom commit messages, pull request title/body contents, etc. They
 * are here because the default behavior is to reference the pull request that snappit is taking
 * screenshots of via a github mention: https://github.com/blog/957-introducing-issue-mentions.
 *
 * NOTE:
 * Since codeship's pullRequestNumber is fetched via an api call, all `pullRequestNumber`
 * values are returned as promises to ensure a more consistent user experience.
 */
let supportedCIEnvironments = {
    travis: {
        name: 'travis',
        url: 'https://travis-ci.org',
        sha1: process.env.TRAVIS_COMMIT_RANGE.slice(43, 50),
        pullRequestNumber: new Promise.resolve(process.env.TRAVIS_PULL_REQUEST)
    },

    codeship: {
        name: 'codeship',
        url: 'https://codeship.io',
        sha1: process.env.CI_COMMIT_ID.slice(0, 7),
        pullRequestNumber: findPullRequestNumber(currentBranch)
    },

    jenkins: {
        name: 'jenkins-ghprb',
        url: 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin',
        sha1: process.env.sha1.slice(0, 7),
        pullRequestNumber: new Promise.resolve(process.env.ghprbPullId)
    }
};

let unknownCIEnvironmentError = `
Your project is running in an unkown CI environment. You'll need to configure your
commit messages, title and body without relying on any convenience variables provided
in this application. This includes the current build's sha1 reference, pull request number,
or github pull requeest link. You can still get this information by specifying your own commit
messages, title and body by using 'process.env.YOUR_COMMIT_SHA', and other techniques inside
of the 'snappit' entry of your protractor configuration file. If you don't do this, you'll have
some default messages appear in for the commit message, pull request body, etc.

Please report this to

https://github.com/rackerlabs/snappit-mocha-protractor/issues

and specify your CI setup to have it added it to the list of supported environments.

Supported CI environments:

${ _.map(supportedCIEnvironments, (details, name) => { name + ': ' + details.url }) }
`;

let currentCIEnvironment = () => {
    if (process.env.TRAVIS) {
        return supportedCIEnvironments.travis.name;
    }

    if (process.env.CI_NAME === 'codeship') {
        return supportedCIEnvironments.codeship.name;
    }

    if (process.env.sha1) {
        return supportedCIEnvironments.jenkins.name;
    }

    console.log(unknownCIEnvironmentError);
};

let currentVars = supportedCIEnvironments[currentCIEnvironment()];
vars = {
    sha1: currentVars.sha1,
    repoSlug: projectRepo.path.slice(1), // drop leading "/" character
    branch: currentBranch,
    pullRequestNumber: currentVars.pullRequestNumber
};

let checkIfRepositoryExists = (repoUrl) => {
    let repositoryInfo = JSON.parse(execSync(`curl ${repoUrl}`).toString('utf-8'));
    return repositoryInfo.message !== 'Not Found';
};

let createRepository = (repoUrl) => {
    let org = repoUrl.path.match(/\/.*\//)[0];
    var data = {
        name: _.last(repoUrl.path.split('/'))
    };

    var options = {
        hostname: `api.${repoUrl.hostname}`,
        path: `/orgs${org}repos`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, function (res) {
            if (res.statusCode !== 201) {
                return reject(new Error(`Something went wrong while creating the repository ${repoUrl.url}!`));
            }
        });

        req.write(JSON.stringify(data));

        req.end();

        return resolve();
    });

};

/**
 * Will fork under the service account's profile, not an org that you can specify.
 * Perhaps someday that will be a nice feature.
 */
let forkRepository = (repoUrl) => {
    let user = config.snappit.cicd.userAccount.userName;
    let repoName = _.last(repoUrl.path.split('/'));

    var options = {
        hostname: `api.${repoUrl.hostname}`,
        path: `/repos/${user}/${repoName}/forks`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, function (res) {
            if (res.statusCode !== 201) {
                return reject(new Error(`Something went wrong while forking the repository ${repoUrl.url}!`));
            }
        });

        req.write(JSON.stringify(data));

        req.end();

        return resolve();
    });

};

let cloneScreenshotsRepo = () => {
    let cloneUrl = `https://${token}@${screenshotsRepo.host}${screenshotsRepo.path}.git`;
    // don't log any of this information out to the console!
    execSync(`git submodule add -f ${cloneUrl} screenshots > /dev/null`);
}

let cmd = command => execSync(`${command}`, { stdio: [0, 1, 2] });
let commitScreenshots = () => {
    cmd(`cd ${config.snappit.screenshotsDirectory}`);
    cmd(`git checkout -b ${config.snappit.cicd.messages.branchName(vars)}`);
    cmd(`git config user.name "${config.snappit.cicd.serviceAccount.userName}"`);
    cmd(`git config user.email "${config.snappit.cicd.serviceAccount.userEmail}"`);
    cmd(`git add -A`);
    cmd(`git status -sb`);
    cmd(`git commit -m "${config.snappit.cicd.messages.commitMessage(vars)}"`);
};

let pushScreenshots = () => {
    let pushUrl = `https://${token}@${screenshotsRepo.host}${screenshots.path}.git`;
    // don't log any of this information out to the console!
    execSync(`git push ${pushUrl} ${config.snappit.cicd.messages.branchName(vars)} > /dev/null 2>&1`);
};

let makePullRequest = () => {
    var data = {
        title: config.snappit.cicd.meessages.pullRequestTitle(vars),
        body: config.snappit.cicd.meessages.pullRequestBody(vars),
        base: config.snappit.cicd.targetBranch,
        head: `${config.snappit.cicd.serviceAccount.userName}:${config.snappit.cicd.meessages.branchName(vars)}`
    };

    var options = {
        hostname: `api.${projectRepo.hostname}`,
        path: `/repos${projectRepo.path}/pulls`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, function (res) {
            if (res.statusCode !== 201) {
                return reject(new Error('Something went wrong with the pull request!'));
            }
        });

        req.write(JSON.stringify(data));

        req.end();

        return resolve();
    });

};
