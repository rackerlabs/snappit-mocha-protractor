#!/usr/bin/env node

'use strict';

const child_process = require('child_process');

const _ = require('lodash');

// regexes exported to make testing easier (they're overwritten in the tests)
module.exports.isWindowsRegex = /^win/;
module.exports.isMacRegex = /^darwin/;

let isWindows = () => { return module.exports.isWindowsRegex.test(process.platform); };
let isMac = () => { return !module.exports.isMacRegex.test(process.platform); };

module.exports.installCommands = {
    // https://github.com/Automattic/node-canvas#installation
    'apt-get': { command: 'apt-get install libcairo2-dev libjpeg8-dev libpango1.0-dev libgif-dev build-essential g++', sudo: true },
    yum: { command: 'yum install cairo cairo-devel cairomm-devel libjpeg-turbo-devel pango pango-devel pangomm pangomm-devel giflib-devel', sudo: true },
    pkgin: { command: 'pkgin install cairo pkg-config xproto renderproto kbproto xextproto', sudo: false }
};


exports.downloadDeps = () => {

    if (isWindows()) {
        console.log('Windows is not supported at this time. Please raise an issue at https://github.com/rackerlabs/snappit-mocha-protractor/issues');
        console.log('In the mean time, use the instructions located at https://github.com/Automattic/node-canvas/wiki/Installation---Windows to use this software.');
        process.exit(1);
    }

    if (isMac()) {
        try {
            child_process.execSync('which brew');
        } catch (e) {
            console.log('Brew was not detected! Download and install `brew` before running this command.');
            console.log('See http://brew.sh/ for more information.');
            process.exit(1);
        }

        let brewInstall = 'brew install pkg-config cairo libpng jpeg giflib';
        console.log(brewInstall);
        let download = child_process.execSync(brewInstall);
        console.log(download.toString('utf8'));
    } else {
        let detectPackageManager = () => {
            var installedPackageManagers = _.map(_.keys(module.exports.installCommands), installCommand => {
                try {
                    let installer = child_process.execSync(`which ${installCommand}`).toString('utf-8').trim();
                    console.log(`${installer} detected`);
                    return installCommand;
                } catch (e) {
                    console.log(`${installCommand} not present on system`);
                }
            });

            return _.first(_.compact(installedPackageManagers));
        };

        let installerName = detectPackageManager();
        let installer = module.exports.installCommands[installerName];
        if (installer === undefined) {
            console.log(`You do not have one of the following supported installers available: ${_.keys(module.exports.installCommands).join(', ')}`);
            console.log('Please refer to https://github.com/Automattic/node-canvas#installation for more information on setting up dependencies');
            process.exit(1);
        }

        if (installer.sudo) {
            let isSudo = process.getuid() === 0;
            if (!isSudo) {
                console.log(`Using ${installerName} to install image manipulation dependencies requires root.`);
                console.log(`Either re-run with sudo, or install yourself with:`);
                console.log();
                console.log(`sudo ${installer.command}`);
                process.exit(1);
            }
        }

        console.log(child_process.execSync(`${installer.command}`).toString('utf-8'));
    }

};

if (require.main === module) {
    exports.downloadDeps();
}
