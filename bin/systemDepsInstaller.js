#!/usr/bin/env node

'use strict';

const child_process = require('child_process');

// regexes exported to make testing easier (they're overwritten in the tests)
module.exports.isWindowsRegex = /^win/;
module.exports.isMacRegex = /^darwin/;

exports.isWindows = () => { return module.exports.isWindowsRegex.test(process.platform); };
exports.isMac = () => { return module.exports.isMacRegex.test(process.platform); };

module.exports.installCommands = {
    // https://github.com/Automattic/node-canvas#installation
    brew: { command: 'brew install pkg-config cairo libpng jpeg giflib', sudo: false },
    'apt-get': { command: 'apt-get install libcairo2-dev libjpeg8-dev libpango1.0-dev libgif-dev build-essential g++', sudo: true },
    yum: { command: 'yum install cairo cairo-devel cairomm-devel libjpeg-turbo-devel pango pango-devel pangomm pangomm-devel giflib-devel', sudo: true },
    pkgin: { command: 'pkgin install cairo pkg-config xproto renderproto kbproto xextproto', sudo: false }
};

let windowsUninstallableWarning = `
Windows is not supported at this time. Please raise an issue at https://github.com/rackerlabs/snappit-mocha-protractor/issues
In the mean time, use the instructions located at https://github.com/Automattic/node-canvas/wiki/Installation---Windows to use this software.
`;

let brewNotAvailableWarning = `
Brew was not detected! Download and install "brew" before running this command.
See http://brew.sh/ for more information.
`;

let noInstallerAvailableMessage = installCommands => { return `
You do not have one of the following supported installers available: ${Object.keys(installCommands).join(', ')}
Please refer to https://github.com/Automattic/node-canvas#installation for more information on setting up dependencies
` };

let needsSudoError = (installerName, installer) => { `
Using ${installerName} to install image manipulation dependencies requires root.
Either re-run with sudo, or install yourself with:

sudo ${installer.command}
`; };

let detectPackageManager = () => {
    var installedPackageManagers = Object.keys(module.exports.installCommands).map(installCommand => {
        try {
            let installer = child_process.execSync(`which ${installCommand}`).toString('utf-8').trim();
            console.log(`${installer} detected`);
            return installCommand;
        } catch (e) {}
    });

    return installedPackageManagers.filter(i => i !== undefined)[0];
};

exports.downloadDeps = (bufferOutput) => {

    if (exports.isWindows()) {
        throw new Error(windowsUninstallableWarning);
    }

    let installerName = detectPackageManager();
    let installer = module.exports.installCommands[installerName];
    if (installer === undefined) {
        if (exports.isMac()) {
            throw new Error(brewNotAvailableWarning);
        }

        throw new Error(noInstallerAvailableMessage(module.exports.installCommands));
    }

    let isSudo = process.getuid() === 0;
    if (installer.sudo && !isSudo) {
        throw new Error(needsSudoError(installerName, installer));
    }

    // we want to stream output almost all the time, unless we're writing
    // unit tests, then we want the output of the command returned as a
    // string so we can verify what's going on here.
    let opts = !bufferOutput ? { stdio: [0, 1, 2] } : {};
    return child_process.execSync(`${installer.command}`, opts);

};

if (require.main === module) {
    exports.downloadDeps();
}
