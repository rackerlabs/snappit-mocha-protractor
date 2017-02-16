'use strict';

// Designed to be used with the Jenkins "build job with parameters" ecosystem to get the `payload` variable.
// See http://stackoverflow.com/a/31572888/881224 for a good overview of what's going on here.
// In your jenkins instance, go ahead and get this script installed someplace.
// Or you can just use `curl` to fetch this from github and source it through node.
// ---------
// node <(curl -s https://raw.githubusercontent.com/rackerlabs/snappit-mocha-protractor/master/bin/statusUpdater.js) ${payload} ${ghToken}
//
// or, use it as a standalone express app if you don't have or want to use jenkins:
// node <(curl -s https://raw.githubusercontent.com/rackerlabs/snappit-mocha-protractor/master/bin/statusUpdater.js) '/endpoint' ${ghToken}

let https = require('https');

let args = process.argv.slice(-2);
let token = args[1];

if (require.main === module) {
    if (process.env.sha1) {
        // jenkins
        let payload = JSON.parse(args[0]);
        updateStatusWithJenkins(payload);
    } else {
        // standalone express app
        let endpoint = args[0];
        startExpressApp(endpoint);
    }
}

let getJsonRegex = /[`]{3}snappit([^`]*)[`]{3}/m;
function parseStatusAutomationFooter = () {
    return JSON.parse(payload.pullRequest.body.match(getJsonRegex)[1]);
}

let insecureAgent = new https.Agent({
    rejectUnauthorized: false
});

function updateStatusWithJenkins(payload) {
    if (payload.action !== 'closed') {
        process.exit(0); // ignore hook events that aren't pull request related
    }

    if (payload.pull_request.merged === false) {
        // the screenshots pull request was closed without being accepted...this is a "failure"
        setStatus('failure').then(() => process.exit(0));
    }

    if (payload.pull_request.merged === true) {
        setStatus('success').then(() => process.exit(0));
    }
}

function startExpressApp(endpoint) {
    console.log('Listening for any incoming pull request hooks from github...');
}

function setStatus(state) {
    let vars = parseStatusAutomationFooter();
    let u = url.parse(vars.status_url);
    console.log(`Setting the status as "${state}" against commit ${vars.sha1}`);

    let data = {
        state: state,
        target_url: payload.pull_request.html_url,
        description: vars.description,
        context: vars.context
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

    if (vars.ignoreSSLWarnings) {
        options.agent = insecureAgent;
    }

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            res.on('data', d => { data.push(d.toString('utf-8'))});
            if (res.statusCode !== 201) {
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while creating the status:\n${data.join('')}`);
                });
            }

            res.on('end', () => {
                resolve(`Setting the status of pull request located at ${vars.target_url} to ${state}.`);
            });
        });

        req.write(JSON.stringify(data));

        req.end();
    });
};
