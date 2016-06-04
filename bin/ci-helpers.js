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
let repoName = _.last(screenshotsRepo.path.split('/'));
let projectOrg = projectRepo.path.match(/\/.*\//)[0].replace(/\//g, '');
let screenshotsOrg = screenshotsRepo.path.match(/\/.*\//)[0].replace(/\//g, '');
let userName = config.snappit.cicd.serviceAccount.userName;
let token = process.env[config.snappit.cicd.githubTokenEnvironmentVariable];

let insecureAgent = new https.Agent({
    rejectUnauthorized: false
});

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
        fn: () => pushCommit
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
            get repoSlug() { return projectRepo.path.slice(1); },
            get sha1() { return process.env.TRAVIS_COMMIT_RANGE.slice(43, 50); },
            get pullRequestNumber() { return process.env.TRAVIS_PULL_REQUEST; },
            get branch() {
                // https://graysonkoonce.com/getting-the-current-branch-name-during-a-pull-request-in-travis-ci/
                if (process.env.TRAVIS_PULL_REQUEST === 'false') {
                    return process.env.TRAVIS_BRANCH;
                }
                return findBranchName(projectRepo, this.pullRequestNumber);
            },
            get targetBranch() { return findTargetBranch(projectRepo, this.pullRequestNumber); }
        },

        codeship: {
            get name() { return 'codeship'; },
            get url() { return 'https://codeship.io'; },
            get repoSlug() { return projectRepo.path.slice(1); },
            get sha1() { return process.env.CI_COMMIT_ID.slice(0, 7); },
            // codeship builds when new commits are pushed, not when pull requests are opened
            get pullRequestNumber() { return findPullRequestNumber(projectRepo, this.branch); },
            get branch() { return process.env.CI_BRANCH; },
            get targetBranch() { return findTargetBranch(projectRepo, this.pullRequestNumber); }
        },

        jenkins: {
            get name() { return 'jenkins'; },
            get url() { return 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin'; },
            get repoSlug() { return projectRepo.path.slice(1); },
            get sha1() { return findSha(projectRepo, this.pullRequestNumber).slice(0, 7); },
            get pullRequestNumber() { return process.env.sha1.match(/pr\/(\d+)\/merge/)[1]; },
            get branch() { return findBranchName(projectRepo, this.pullRequestNumber); },
            get targetBranch() { return findTargetBranch(projectRepo, this.pullRequestNumber); }
        },

        undefined: {
            get name() { return 'unknown-ci-provider'; },
            get url() { return 'https://github.com/rackerlabs/snappit-mocha-protractor/issues/new'; },
            get repoSlug() { return projectRepo.path.slice(1); },
            get sha1() { return 'sha1-unavailable'; },
            get pullRequestNumber() { return 'pull-request-number-unavailable'; },
            get branch() { return 'branch-unavailable'; },
            get targetBranch() { return 'target-branch-unavailable'; }
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
    let u =  buildApiUrl(repoUrl, `/orgs/${screenshotsOrg}/repos`);
    let data = {
        name: _.last(repoUrl.path.split('/')),
        auto_init: true,
        private: config.snappit.cicd.privateRepo
    };

    if (config.snappit.cicd.serviceAccount.teamId !== undefined) {
        data.team_id = config.snappit.cicd.serviceAccount.teamId;
    }

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

    if (config.snappit.ignoreSSLWarnings) {
        options.agent = insecureAgent;
    }

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            res.on('data', d => { data.push(d.toString('utf-8'))});
            if (res.statusCode !== 201) {
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

    if (config.snappit.ignoreSSLWarnings) {
        options.agent = insecureAgent;
    }

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

/**
 * This will create a screenshots repo, if it does not exist, then it will create a fork of that
 * using your service account's credentials. It will then clone it as a submodule into your project.
 * Afterwards, it will find out what the target branch is in the project repo's pull request, and configure
 * the submodule of your screenshot repository to mimic that branch set up.
 * @see findAndCreateTargetBranch
 */
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
        configureGitUser();
        findAndCreateTargetBranch();
    });
};

function configureGitUser() {
    console.log(`Preparing service account ${userName} to commit locally.`);
    let cmds = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git config user.name "${userName}"`,
        `git config user.email "${config.snappit.cicd.serviceAccount.userEmail}"`,
        `cd ..`
    ];
    cmd(cmds.join('; '));
};

function commitScreenshots() {
    let cmds = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git checkout ${getVars().targetBranch}`,
        `git checkout -b ${config.snappit.cicd.messages.branchName(getVars())}`,
        `git add -A`,
        `git status -sb`,
        `git commit -m "${config.snappit.cicd.messages.commitMessage(getVars())}"`,
        `cd ..`
    ];
    try {
        cmd(cmds.join('; '));
    } catch (e) { /* Nothing to commit */ }
};

function pushCommit(pushUpstream, branchName) {
    // pushes to the fork created by the service account by default, not the main screenshots repo
    let destination = pushUpstream ? projectOrg : userName;
    if (branchName === undefined) {
        branchName = config.snappit.cicd.messages.branchName(getVars());
    }

    let pushUrl = `https://${token}@${screenshotsRepo.hostname}/${destination}/${repoName}.git`;

    // don't log any of this information out to the console!
    let sensitiveCommand = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git push ${pushUrl} ${branchName}`,
        `cd ..`
    ].join('; ');

    cmd(sensitiveCommand);
};

function makePullRequest(repoUrl) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls`);
    let data = {
        title: config.snappit.cicd.messages.pullRequestTitle(getVars()),
        body: config.snappit.cicd.messages.pullRequestBody(getVars()),
        head: `${userName}:${config.snappit.cicd.messages.branchName(getVars())}`,
        base: config.snappit.cicd.targetBranch || getVars().targetBranch
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

    if (config.snappit.ignoreSSLWarnings) {
        options.agent = insecureAgent;
    }

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
    if (repoUrl.hostname !== 'github.com') {
        // github enterprise
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
 * because they use the same environment variable for both "push" and "pr" builds.
 * Jenkins only exposes a singular pull request number as well. So,
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
 * this searches for any pull requests that match the current branch.
 */
function findPullRequestNumber(repoUrl, branchName) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls?head=${projectOrg}:${branchName}`);
    let pullRequests = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    if (pullRequests.length) {
        return pullRequests[0].number;
    }
};

/**
 * Jenkins pull request builder, when set up according to the readme instructions,
 * https://github.com/jenkinsci/ghprb-plugin#creating-a-job, will only expose a single
 * "sha1" environment variable, which isn't even a sha1. It's the string "/{REMOTE}/pr/{NUMBER}/merge".
 * All information regarding commit shas, branch names, etc., are pulled from github's API using this PR number.
 */
function findSha(repoUrl, pullRequestNumber) {
    let u =  buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls/${pullRequestNumber}`);
    let pullRequest = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    if (pullRequest.message === undefined) {
        return pullRequest.head.sha;
    }
};

/**
 * Find the current target branch for the project's pull request. If this target branch does not yet exist
 * in the screenshots repository, it will be created.
 *
 * Why:
 * Not all screenshot pull request should target the master branch.
 * For projects that support multiple versions of the same project (e.g., a long running 2.x branch
 * while simultaneously supporting a 1.x version on `master`), this will designate all screenshots to
 * merge into a branch that is named the same as the branch the project's pull request is targeting.
 *
 * Example:
 * A pull request is opened against master, `feature-for-master`. The screenshots for that pull request
 * will be made against the screenshot repository's master branch. Another pull request is opened against
 * the 2.x branch, `feature-for-2.x`. The screenshots for *that* pull request will be made against the
 * screenshot repository's 2.x branch. If you do not have a "2.x" branch yet in your screenshots repository,
 * it will be created for you.
 */
function findAndCreateTargetBranch() {
    let projectTargetBranchName = getVars().targetBranch;
    if (!branchExists(projectTargetBranchName)) {
        console.log(`No branch to merge against: target branch ${projectTargetBranchName}. Creating...`);
        checkoutOrphanedBranch(projectTargetBranchName);
        // doesn't actually push the "commit", but will push this new branch up
        let pushUpstream = true;
        pushCommit(pushUpstream, projectTargetBranchName);
    }
    return projectTargetBranchName;
};

/**
 * Get the name of the branch the the project's pull request is targeting.
 * Most of the time, this is "master".
 */
function findTargetBranch(repoUrl, pullRequestNumber) {
    let u = buildApiUrl(repoUrl, `/repos${repoUrl.path}/pulls/${pullRequestNumber}`);
    let pullRequest = JSON.parse(execSync(`curl ${buildCurlFlags()} ${u.href} 2>/dev/null`).toString('utf-8'));
    if (pullRequest.message === undefined) {
        return pullRequest.base.ref;
    }
};

/**
 * `branchName` must be an exact match the the branch you're looking for.
 */
function branchExists(branchName) {
    let branches = '';
    try {
        branches = execSync(`git branch -a --no-color | grep "  remotes/origin/${branchName}$"`).toString('utf-8');
    } catch (e) {}
    return Boolean(branches.length);
};

/**
 * Will create a branch that has absolutely no history in common with the project, save for the first commit.
 * For repositories generated with this tool, will include only a single "Initial Commit" parent commit.
 */
function checkoutOrphanedBranch(branchName) {
    let cmds = [
        `cd ${config.snappit.screenshotsDirectory}`,
        // check out an orphaned (no history) branch http://stackoverflow.com/a/4288660/881224
        // and set its parent to the first commit (inital commit) http://stackoverflow.com/a/1007545/881224
        `git checkout --orphan ${branchName} $(git rev-list --max-parents=0 HEAD)`,
        // delete everything that we care about (directories that aren't the .git directory)
        `find . -maxdepth 1 -mindepth 1 -type d | grep -v "./\.git" | xargs rm -rf`,
        `git commit --allow-empty -m "chore(branch): Initialize new branch '${branchName}'"`,
        `cd ..`
    ];
    try {
        cmd(cmds.join('; '));
    } catch (e) { /* Nothing to commit */ }
};
