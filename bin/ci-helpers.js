#!/usr/bin/env node

'use strict';

let execSync = require('child_process').execSync;
let https = require('https');
let url = require('url');

let _ = require('lodash');

let descriptions = require('./descriptions');
let configOptions = require('./config');

let args = process.argv.slice(2);
let action = args[1];

if (args[0] === undefined) {
    descriptions.showHelpTextAndQuit('Your first argument must be the path to your protractor.conf.js file.');
};

let config = configOptions.fromProtractorConf(args[0]);

let projectRepo = url.parse(config.snappit.cicd.projectRepo);
let screenshotsRepo = url.parse(config.snappit.cicd.screenshotsRepo);
let org = projectRepo.path.match(/\/.*\//)[0].replace(/\//g, '');
let userName = config.snappit.cicd.serviceAccount.userName;
let token = process.env[config.snappit.cicd.githubTokenEnvironmentVariable];

/**
 * Actions that are supported by the ci helpers. If you want to add new functions, this is the place to do it.
 * All action references throughout the help text, etc., are generated via this object. Define all actions here.
 */
let actions = {
    clone: {
        description: descriptions.cloneDescription,
        fn: createForkAndClone
    },

    commit: {
        description: descriptions.commitDescription,
        fn: commitScreenshots
    },

    push: {
        description: descriptions.pushDescription,
        fn: () => pushCommit(screenshotsRepo)
    },

    pr: {
        description: descriptions.prDescription,
        fn: () => makePullRequest(screenshotsRepo)
    }
};

if (require.main === module) {
    if (action === undefined || !_.includes(_.keys(actions), action)) {
        // pass in `undefined` here to use default help text
        descriptions.showHelpTextAndQuit(undefined, actions);
    }

    actions[action].fn();
};

/**
 * Supported CI Environments. All this means is that there's some "convenience" vars available
 * to users to construct custom commit messages, pull request title/body contents, etc. They
 * are here because the default behavior is to reference the pull request that snappit is taking
 * screenshots of via a github mention: https://github.com/blog/957-introducing-issue-mentions.
 * The values under each key are under a getter function to prevent javascript from evaluating the contents
 * of those values in environments where it doesn't make sense (such as in local testing).
 */
function getSupportedCIEnvironments() {
    return {
        travis: {
            get name() { return 'travis'; },
            get url() { return 'https://travis-ci.org'; },
            get repoSlug() { return projectRepo.path.slice(1) },
            get sha1() { return process.env.TRAVIS_COMMIT_RANGE.slice(43, 50); },
            get pullRequestNumber() { return process.env.TRAVIS_PULL_REQUEST; },
            get branch() {
                // https://graysonkoonce.com/getting-the-current-branch-name-during-a-pull-request-in-travis-ci/
                if (process.env.TRAVIS_PULL_REQUEST === 'false') {
                    return process.env.TRAVIS_BRANCH;
                }
                return findBranchName(projectRepo, this.pullRequestNumber);
            }
        },

        codeship: {
            get name() { return 'codeship'; },
            get url() { return 'https://codeship.io'; },
            get repoSlug() { return projectRepo.path.slice(1) },
            get sha1() { return process.env.CI_COMMIT_ID.slice(0, 7); },
            // codeship builds when new commits are pushed, not when pull requests are opened
            get pullRequestNumber() { return findPullRequestNumber(projectRepo, this.branch); },
            get branch() { return process.env.CI_BRANCH; }
        },

        'jenkins-ghprb': {
            get name() { return 'jenkins-ghprb'; },
            get url() { return 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin'; },
            get repoSlug() { return projectRepo.path.slice(1) },
            get sha1() { return process.env.sha1.slice(0, 7); },
            get pullRequestNumber() { return process.env.ghprbPullId; },
            get branch() { return process.env.ghprbSourceBranch; }
        },

        undefined: {
            get name() { return 'unknown-ci-provider'; },
            get url() { return 'https://github.com/rackerlabs/snappit-mocha-protractor/issues/new'; },
            get repoSlug() { return projectRepo.path.slice(1) },
            get sha1() { return 'sha1-unavailable'; },
            get pullRequestNumber() { return 'pull-request-number-unavailable'; },
            get branch() { return 'branch-unavailable'; }
        }
    };
};

function getCurrentCIEnvironment() {
    if (process.env.TRAVIS) {
        return getSupportedCIEnvironments().travis.name;
    } else if (process.env.CI_NAME) {
        return getSupportedCIEnvironments().codeship.name;
    } else if (process.env.sha1) {
        return getSupportedCIEnvironments().jenkins.name;
    } else {
        console.log(descriptions.unknownCIEnvironmentError);
        console.log('Supported CI environments:');
        _.each(getSupportedCIEnvironments(), (details, name) => {
            // don't print the undefined ci env details
            if (name !== 'undefined') {
                console.log(name + ': ' + details.url);
            }
        });
        console.log();
    }
};

function getVars() {
    return getSupportedCIEnvironments()[getCurrentCIEnvironment()]
};

function createRepository(repoUrl) {
    let u =  buildApiUrl(repoUrl, `/orgs/${org}/repos`);
    let data = {
        name: _.last(repoUrl.path.split('/')),
        auto_init: true,
        private: config.snappit.cicd.privateRepo
    };

    if (config.snappit.cicd.serviceAccount.teamId !== undefined) {
        data.team_id = config.snappit.cicd.serviceAccount.teamId;
    }

    let options = {
        hostname: `${u.hostname}`,
        path: u.path,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            if (res.statusCode !== 201) {
                var data = [];
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while creating the repository ${repoUrl.href}:\n${data.join('')}`);
                });
            }

            res.on('end', () => {
                if (!repositoryExists(repoUrl)) {
                    do {
                        setTimeout(() => {
                            console.log(`Waiting on newly created repository ${repoUrl.href} to appear...`)
                        }, 1000);
                    } while (!repositoryExists(repoUrl))
                }
                resolve(`Created a new repository at ${repoUrl.href}`);
            });
        });

        req.write(JSON.stringify(data));

        req.end();
    });

};

/**
 * Will fork under the service account's profile, not an org that you can specify.
 * Perhaps someday that will be a nice feature.
 */
function forkRepository(repoUrl) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/forks`);
    let options = {
        hostname: u.hostname,
        path: u.path,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            if (res.statusCode !== 202) {
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while forking the repository ${repoUrl.href}:\n${data.join('')}`);
                });
            }
            resolve(`Forked the repository ${repoUrl.href}`);
        });

        req.end();
    });
};

function cloneRepo(repoUrl) {
    let cloneUrl = `https://${token}@${repoUrl.host}${repoUrl.path}.git`;
    // don't log any of this information out to the console!
    execSync(`git submodule add -f ${cloneUrl} ${config.snappit.screenshotsDirectory} > /dev/null`);
    console.log(`Cloned a submodule for screenshots in directory "${repoUrl.href}"`);
};

function createForkAndClone() {
    if (!repositoryExists(projectRepo)) {
        throw new Error(`Main project repo ${projectRepo.href} does not exist! Create it first, then retry.`);
    }

    let repoAction = Promise.resolve(`Repository ${screenshotsRepo.href} already exists.`);
    if (!repositoryExists(screenshotsRepo)) {
        console.log(`Screenshots repository ${screenshotsRepo.href} not found. Creating...`);
        repoAction = createRepository(screenshotsRepo);
    }

    // will either create a repo (if it doesn't exist), or return a message stating that it does exist
    return repoAction.then(message => {
        console.log(message);
        let repoName = _.last(screenshotsRepo.path.split('/'));
        let forkedRepo = url.parse(`https://${screenshotsRepo.hostname}/${userName}/${repoName}`);
        if (!repositoryExists(forkedRepo)) {
            return forkRepository(screenshotsRepo).then((message) => {
                console.log(message);
                do {
                    setTimeout(() => {
                        console.log(`Waiting on forked repository ${forkedRepo.href} to appear...`)
                    }, 1000);
                } while (!repositoryExists(forkedRepo))
            });
        } else {
            console.log(`Forked screenshots repository ${forkedRepo.href} already exists.`);
        }

        cloneRepo(screenshotsRepo);
    });
};

function commitScreenshots() {
    let cmds = [
        `pwd`,
        `cd ${config.snappit.screenshotsDirectory}`,
        `pwd`,
        `git checkout -b ${config.snappit.cicd.messages.branchName(getVars())}`,
        `git config user.name "${userName}"`,
        `git config user.email "${config.snappit.cicd.serviceAccount.userEmail}"`,
        `git add -A`,
        `git status -sb`,
        `git commit -m "${config.snappit.cicd.messages.commitMessage(getVars())}"`
    ];
    try {
        cmd(cmds.join('; '));
    } catch (e) { /* Nothing to commit */ }
};

function pushCommit() {
    // pushes to the fork created by the service account by default, not the main screenshots repo
    let repoName = _.last(screenshotsRepo.path.split('/'));
    let pushUrl = `https://${token}@${screenshotsRepo.hostname}/${userName}/${repoName}.git`;
    // don't log any of this information out to the console!
    let sensitiveCommand = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git push ${pushUrl} ${config.snappit.cicd.messages.branchName(getVars())} > /dev/null 2>&1`
    ].join('; ');

    execSync(sensitiveCommand);
};

function makePullRequest(repoUrl) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls`);
    let data = {
        title: config.snappit.cicd.messages.pullRequestTitle(getVars()),
        body: config.snappit.cicd.messages.pullRequestBody(getVars()),
        head: `${userName}:${config.snappit.cicd.messages.branchName(getVars())}`,
        base: config.snappit.cicd.targetBranch
    };

    let options = {
        hostname: u.hostname,
        path: u.path,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            if (res.statusCode !== 201) {
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    let error = JSON.parse(data).errors[0].message;
                    if (_.startsWith(error, 'No commits between')) {
                        // this is fine. No new changes in the screenshots, so no pull request
                        resolve();
                    } else {
                        throw new Error(`(HTTP ${res.statusCode}) Something went wrong with the pull request:\n${data.join('')}`);
                    }
                });
            }
            resolve();
        });

        req.write(JSON.stringify(data));

        req.end();
    });
};

function cmd(command) {
    execSync(`${command}`, { stdio: [0, 1, 2] })
};

/**
 * Enterprise github has a different url signature for api requests.
 */
function buildApiUrl(repoUrl, resource) {
    if (config.snappit.cicd.githubEnterprise) {
        return url.parse(`https://${repoUrl.hostname}/api/v3${resource}`);
    }

    return url.parse(`https://api.${repoUrl.hostname}${resource}`);
};

function buildCurlFlags() {
    let flags = [
        `-H "Authorization: token ${token}"`,
        '-H "User-Agent: snappit"'
    ];
    if (config.snappit.cicd.ignoreSSLWarnings) {
        flags.unshift('-k');
    }
    return flags.join(' ');
};

function repositoryExists(repoUrl) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}`);
    let repositoryInfo = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    return repositoryInfo.message !== 'Not Found';
};

/**
 * Travis doesn't natively support getting you the branch name from a build
 * because they use the same environment variable for both "push" and "pr" builds. So,
 * this searches for any branch names that match the current pull request number.
 * If no branch is found, then a warning text is returned instead.
 */
function findBranchName(repoUrl, pullRequestNumber) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls/${pullRequestNumber}`);
    let pullRequest = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    if (pullRequest.message === undefined) {
        return pullRequest.head.ref;
    }
};

/**
 * Codeship doesn't natively support getting you the pull request number from a build
 * because they build as soon as a commit is pushed, not when a PR is opened. So,
 * this searches for any pull requests that match the current branch. If no pull request
 * is open, then a warning text is returned instead.
 */
function findPullRequestNumber(repoUrl, branchName) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls?head=${org}:${branchName}`);
    let pullRequests = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    if (pullRequests.length) {
        return pullRequests[0].number;
    }
};
